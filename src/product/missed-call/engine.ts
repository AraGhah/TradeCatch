import {
  buildDedupeKey,
  classifyCall,
  dedupeWindowBucket,
  shouldStartRecovery,
} from "./call-handling";
import {
  appendConversation,
  createLeadFromWorkflow,
  logUrgencyOnLead,
  markAlertResponse,
  pushTechnicianAlert,
  recordTechnicianResponse,
  syncLeadFromWorkflow,
} from "./crm";
import {
  applyAnswer,
  customerNotifyAccepted,
  enabledQuestions,
  isEnglishRequest,
  isFrenchRequest,
  isOptOut,
  isPhotoSkip,
  nextCollectionStep,
  openingSms,
  promptForStep,
} from "./messaging";
import { checkServiceArea } from "./service-area";
import type { MissedCallStore } from "./store";
import {
  buildJobCardSms,
  humanReviewAlertBody,
  parseTechnicianAction,
  shouldEscalate,
  technicianForStage,
} from "./technicians";
import { classifyUrgency, rosterTechnician } from "./urgency";
import type {
  CallRecord,
  ClientAccount,
  Clock,
  CollectionStep,
  EscalationStage,
  MissedCallWorkflow,
  SmsPort,
} from "./types";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function pushEvent(
  workflow: MissedCallWorkflow,
  type: string,
  detail?: string,
  clock?: Clock,
): void {
  const at = (clock?.now() ?? new Date()).toISOString();
  workflow.events.push({ at, type, detail });
  workflow.updatedAt = at;
}

export type MissedCallEngine = {
  handleCallEvent(input: {
    clientAccountId: string;
    callerE164: string;
    calledAt?: Date;
    answered: boolean;
    abandoned: boolean;
    twilioCallSid?: string;
    durationSeconds?: number;
  }): Promise<{
    call: CallRecord;
    workflow: MissedCallWorkflow | null;
    smsSent: boolean;
    suppressedReason?: string;
  }>;

  handleInboundSms(input: {
    fromE164: string;
    toE164: string;
    body: string;
    mediaUrls?: string[];
  }): Promise<{ handled: boolean; replies: string[] }>;

  processEscalations(): Promise<{ escalated: string[] }>;
};

export function createMissedCallEngine(deps: {
  store: MissedCallStore;
  sms: SmsPort;
  clock?: Clock;
}): MissedCallEngine {
  const clock = deps.clock ?? { now: () => new Date() };

  async function ensureLead(workflow: MissedCallWorkflow): Promise<void> {
    let lead = await deps.store.getLeadByWorkflowId(workflow.id);
    if (!lead) {
      lead = createLeadFromWorkflow(workflow, workflow.callId, clock.now());
      workflow.leadId = lead.id;
      await deps.store.saveLead(lead);
    } else {
      syncLeadFromWorkflow(lead, workflow);
      await deps.store.saveLead(lead);
    }
  }

  async function logSmsConversation(input: {
    workflow: MissedCallWorkflow;
    direction: "inbound" | "outbound";
    fromE164: string;
    toE164: string;
    body: string;
    mediaUrls?: string[];
    actor: "customer" | "technician" | "system";
  }): Promise<void> {
    const lead = await deps.store.getLeadByWorkflowId(input.workflow.id);
    if (!lead) return;
    appendConversation(lead, {
      at: clock.now().toISOString(),
      direction: input.direction,
      fromE164: input.fromE164,
      toE164: input.toE164,
      body: input.body,
      mediaUrls: input.mediaUrls,
      actor: input.actor,
    });
    await deps.store.saveLead(lead);
  }

  async function sendPrompt(
    workflow: MissedCallWorkflow,
    clientId: string,
    step: CollectionStep,
  ): Promise<string | null> {
    const client = await deps.store.getClient(clientId);
    if (!client) return null;
    const body = promptForStep(client, step, workflow.collected.language);
    if (!body) return null;
    await deps.sms.send({
      toE164: workflow.callerE164,
      fromE164: client.smsFromNumber,
      body,
    });
    pushEvent(workflow, "sms_sent", step, clock);
    await logSmsConversation({
      workflow,
      direction: "outbound",
      fromE164: client.smsFromNumber,
      toE164: workflow.callerE164,
      body,
      actor: "system",
    });
    return body;
  }

  function applyServiceArea(workflow: MissedCallWorkflow, client: ClientAccount) {
    const addr = workflow.collected.serviceAddress;
    if (!addr) return;
    const result = checkServiceArea(addr, client.approvedServiceAreas);
    workflow.serviceArea = result.verdict;
    workflow.serviceAreaFlagged =
      result.verdict !== "inside" || result.sendToHuman;
    if (result.sendToHuman) {
      workflow.humanReviewRequired = true;
      pushEvent(
        workflow,
        "service_area_flagged",
        `${result.verdict}:${result.matchedRuleId ?? "none"}`,
        clock,
      );
    } else {
      pushEvent(workflow, "service_area_inside", result.matchedRuleId, clock);
    }
  }

  function applyUrgency(workflow: MissedCallWorkflow, client: ClientAccount) {
    const desc = workflow.collected.issueDescription;
    if (!desc) return;
    const { classification, log } = classifyUrgency({
      issueDescription: desc,
      rubric: client.urgencyRubric,
      at: clock.now(),
    });
    workflow.urgency = classification;
    if (classification.requiresHuman) {
      workflow.humanReviewRequired = true;
    }
    pushEvent(
      workflow,
      "urgency_classified",
      `${classification.level}:${classification.source}`,
      clock,
    );
    if (classification.escalated) {
      pushEvent(workflow, "urgency_escalated", classification.source, clock);
    }
    void deps.store.getLeadByWorkflowId(workflow.id).then((lead) => {
      if (lead) {
        logUrgencyOnLead(lead, log);
        void deps.store.saveLead(lead);
      }
    });
  }

  async function notifyHumanReview(
    workflow: MissedCallWorkflow,
    client: ClientAccount,
    reason: string,
  ): Promise<void> {
    const phone =
      client.humanReviewPhone ??
      rosterTechnician(client, client.ownerTechnicianId ?? "")?.phone;
    if (!phone) return;
    const body = humanReviewAlertBody(
      client,
      workflow.collected,
      reason,
      workflow.id,
    );
    await deps.sms.send({
      toE164: phone,
      fromE164: client.smsFromNumber,
      body,
    });
    pushEvent(workflow, "human_review_alerted", reason, clock);
    workflow.status = "awaiting_human";
  }

  async function sendJobCard(
    workflow: MissedCallWorkflow,
    client: ClientAccount,
    stage: EscalationStage,
  ): Promise<boolean> {
    const tech = technicianForStage(client, stage, clock.now());
    if (!tech) return false;

    const body = buildJobCardSms({
      client,
      collected: workflow.collected,
      callerE164: workflow.callerE164,
      urgency: workflow.urgency,
      serviceAreaFlagged: workflow.serviceAreaFlagged,
      humanReviewRequired: workflow.humanReviewRequired,
      workflowId: workflow.id,
    });

    const sentAt = clock.now().toISOString();
    await deps.sms.send({
      toE164: tech.phone,
      fromE164: client.smsFromNumber,
      body,
    });

    pushTechnicianAlert(workflow, {
      technicianId: tech.id,
      phone: tech.phone,
      sentAt,
      stage,
    });
    pushEvent(workflow, "technician_alerted", `${stage}:${tech.id}`, clock);
    workflow.status = workflow.humanReviewRequired
      ? "awaiting_human"
      : "awaiting_technician";
    await logSmsConversation({
      workflow,
      direction: "outbound",
      fromE164: client.smsFromNumber,
      toE164: tech.phone,
      body,
      actor: "system",
    });
    return true;
  }

  async function finalizeAndDispatch(workflow: MissedCallWorkflow): Promise<void> {
    const client = await deps.store.getClient(workflow.clientAccountId);
    if (!client) return;

    workflow.currentStep = "done";
    await ensureLead(workflow);

    if (workflow.humanReviewRequired) {
      const reasons: string[] = [];
      if (workflow.serviceAreaFlagged) reasons.push("zone de service");
      if (workflow.urgency?.requiresHuman) reasons.push("urgence critique/incertaine");
      await notifyHumanReview(
        workflow,
        client,
        reasons.join(", ") || "revue requise",
      );
    }

    const sent = await sendJobCard(workflow, client, "primary");
    if (!sent) {
      workflow.status = "stopped";
      workflow.stopReason = "manual_stop";
      pushEvent(workflow, "no_technician_configured", undefined, clock);
    }
    await deps.store.saveWorkflow(workflow);
    await ensureLead(workflow);
  }

  async function escalateWorkflow(
    workflow: MissedCallWorkflow,
    nextStage: EscalationStage,
  ): Promise<void> {
    const client = await deps.store.getClient(workflow.clientAccountId);
    if (!client) return;

    if (nextStage === "exhausted") {
      workflow.status = "stopped";
      workflow.stopReason = "technician_timeout";
      workflow.outcome = "human_review";
      pushEvent(workflow, "escalation_exhausted", undefined, clock);
      await notifyHumanReview(
        workflow,
        client,
        "aucun technicien n'a accepté",
      );
      await deps.store.saveWorkflow(workflow);
      await ensureLead(workflow);
      return;
    }

    pushEvent(workflow, "escalation_timer", nextStage, clock);
    await sendJobCard(workflow, client, nextStage);
    await deps.store.saveWorkflow(workflow);
    await ensureLead(workflow);
  }

  async function handleTechnicianSms(
    techWorkflow: MissedCallWorkflow,
    input: { fromE164: string; body: string },
  ): Promise<{ handled: boolean; replies: string[] }> {
    const replies: string[] = [];
    const client = await deps.store.getClient(techWorkflow.clientAccountId);
    if (!client) return { handled: false, replies };

    const action = parseTechnicianAction(input.body);
    const tech = rosterTechnician(
      client,
      techWorkflow.assignedTechnicianId ?? "",
    );

    if (action === "call") {
      markAlertResponse(
        techWorkflow,
        techWorkflow.assignedTechnicianId ?? "",
        "call_customer",
        clock.now(),
      );
      pushEvent(techWorkflow, "technician_call_customer", tech?.id, clock);
      replies.push(`Appelez le client: ${techWorkflow.callerE164}`);
      await deps.store.saveWorkflow(techWorkflow);
      await ensureLead(techWorkflow);
      return { handled: true, replies };
    }

    if (action === "accept") {
      markAlertResponse(
        techWorkflow,
        techWorkflow.assignedTechnicianId ?? "",
        "accepted",
        clock.now(),
      );
      techWorkflow.status = "completed";
      techWorkflow.stopReason = "completed";
      techWorkflow.outcome = "technician_accepted";
      pushEvent(techWorkflow, "technician_accepted", tech?.id, clock);

      const lead = await deps.store.getLeadByWorkflowId(techWorkflow.id);
      if (lead && techWorkflow.technicianAlertedAt) {
        recordTechnicianResponse(
          lead,
          techWorkflow.technicianAlertedAt,
          clock.now(),
          true,
        );
      }

      const notify = customerNotifyAccepted(
        client,
        techWorkflow.collected.language,
        tech?.name ?? "Le technicien",
      );
      await deps.sms.send({
        toE164: techWorkflow.callerE164,
        fromE164: client.smsFromNumber,
        body: notify,
      });
      pushEvent(techWorkflow, "customer_notified", undefined, clock);
      pushEvent(techWorkflow, "outcome_recorded", "technician_accepted", clock);
      await deps.store.saveWorkflow(techWorkflow);
      await ensureLead(techWorkflow);
      replies.push("Demande acceptée. Le client a été avisé.");
      return { handled: true, replies };
    }

    if (action === "decline") {
      markAlertResponse(
        techWorkflow,
        techWorkflow.assignedTechnicianId ?? "",
        "declined",
        clock.now(),
      );
      pushEvent(techWorkflow, "technician_declined", tech?.id, clock);
      const lead = await deps.store.getLeadByWorkflowId(techWorkflow.id);
      if (lead && techWorkflow.technicianAlertedAt) {
        recordTechnicianResponse(
          lead,
          techWorkflow.technicianAlertedAt,
          clock.now(),
          false,
        );
      }
      let nextStage: EscalationStage = "exhausted";
      if (techWorkflow.escalationStage === "primary") {
        nextStage = client.backupTechnicianIds.length ? "backup" : "owner";
      } else if (techWorkflow.escalationStage === "backup") {
        nextStage = client.ownerTechnicianId ? "owner" : "exhausted";
      }
      if (nextStage === "exhausted") {
        techWorkflow.status = "stopped";
        techWorkflow.stopReason = "technician_declined";
        techWorkflow.outcome = "technician_declined";
        pushEvent(techWorkflow, "outcome_recorded", "technician_declined", clock);
        await deps.store.saveWorkflow(techWorkflow);
        await ensureLead(techWorkflow);
        replies.push("Refus enregistré.");
        return { handled: true, replies };
      }
      await escalateWorkflow(techWorkflow, nextStage);
      replies.push("Refus enregistré. Relais au prochain technicien.");
      return { handled: true, replies };
    }

    replies.push("Répondez ACCEPTER, REFUSER ou APPELER.");
    return { handled: true, replies };
  }

  return {
    async handleCallEvent(input) {
      const client = await deps.store.getClient(input.clientAccountId);
      if (!client) {
        throw new Error(`Unknown client account: ${input.clientAccountId}`);
      }

      const calledAt = input.calledAt ?? clock.now();
      const disposition = classifyCall({
        client,
        calledAt,
        answered: input.answered,
        abandoned: input.abandoned,
      });

      const call: CallRecord = {
        id: id("call"),
        clientAccountId: client.id,
        callerE164: input.callerE164,
        calledAt: calledAt.toISOString(),
        disposition,
        durationSeconds: input.durationSeconds,
        twilioCallSid: input.twilioCallSid,
      };
      await deps.store.saveCall(call);

      if (!shouldStartRecovery(disposition)) {
        return {
          call,
          workflow: null,
          smsSent: false,
          suppressedReason:
            disposition === "answered"
              ? "call_answered"
              : disposition === "abandoned"
                ? "call_abandoned_no_sms"
                : "not_eligible",
        };
      }

      const bucket = dedupeWindowBucket(calledAt, client.duplicateWindowMs);
      const dedupeKey = buildDedupeKey(client.id, input.callerE164, bucket);
      const existing =
        await deps.store.findActiveWorkflowByDedupeKey(dedupeKey);
      if (existing) {
        pushEvent(existing, "duplicate_call_suppressed", call.id, clock);
        await deps.store.saveWorkflow(existing);
        return {
          call,
          workflow: existing,
          smsSent: false,
          suppressedReason: "duplicate_suppressed",
        };
      }

      const now = clock.now().toISOString();
      const workflow: MissedCallWorkflow = {
        id: id("wf"),
        clientAccountId: client.id,
        callId: call.id,
        callerE164: input.callerE164,
        status: "awaiting_customer",
        currentStep: "language",
        collected: { language: "fr", photoUrls: [] },
        escalationStage: "primary",
        technicianAlerts: [],
        outcome: "open",
        events: [],
        createdAt: now,
        updatedAt: now,
        dedupeKey,
      };
      pushEvent(workflow, "workflow_started", disposition, clock);

      const open = openingSms(client);
      await deps.sms.send({
        toE164: input.callerE164,
        fromE164: client.smsFromNumber,
        body: open,
      });
      pushEvent(workflow, "sms_sent", "opening_fr", clock);
      await deps.store.saveWorkflow(workflow);

      return { call, workflow, smsSent: true };
    },

    async handleInboundSms(input) {
      const replies: string[] = [];

      const techWorkflow = await deps.store.findWorkflowByTechnicianPhone(
        input.fromE164,
      );
      if (techWorkflow) {
        return handleTechnicianSms(techWorkflow, input);
      }

      const client = await deps.store.findClientBySmsFromNumber(input.toE164);
      if (!client) return { handled: false, replies };

      if (isOptOut(input.body, client)) {
        const wf = await deps.store.findActiveWorkflowByCaller(
          client.id,
          input.fromE164,
        );
        if (wf) {
          wf.status = "stopped";
          wf.stopReason = "opt_out";
          wf.outcome = "cancelled";
          pushEvent(wf, "opt_out", undefined, clock);
          pushEvent(wf, "outcome_recorded", "cancelled", clock);
          await deps.store.saveWorkflow(wf);
          await ensureLead(wf);
        }
        const bye =
          "Vous êtes désabonné. Vous ne recevrez plus de textos de notre part. / You are unsubscribed.";
        await deps.sms.send({
          toE164: input.fromE164,
          fromE164: client.smsFromNumber,
          body: bye,
        });
        return { handled: true, replies };
      }

      const workflow = await deps.store.findActiveWorkflowByCaller(
        client.id,
        input.fromE164,
      );
      if (!workflow || workflow.status !== "awaiting_customer") {
        return { handled: false, replies };
      }

      await logSmsConversation({
        workflow,
        direction: "inbound",
        fromE164: input.fromE164,
        toE164: input.toE164,
        body: input.body,
        mediaUrls: input.mediaUrls,
        actor: "customer",
      });

      if (workflow.currentStep === "language") {
        if (isEnglishRequest(input.body)) {
          workflow.collected.language = "en";
        } else if (isFrenchRequest(input.body)) {
          workflow.collected.language = "fr";
        } else {
          workflow.collected.language = "fr";
        }
        const next = nextCollectionStep(client, workflow.collected, "language");
        workflow.currentStep = next;
        pushEvent(workflow, "language_set", workflow.collected.language, clock);
        if (next === "done") {
          await finalizeAndDispatch(workflow);
          return { handled: true, replies };
        }
        const prompt = await sendPrompt(workflow, client.id, next);
        if (prompt) replies.push(prompt);
        await deps.store.saveWorkflow(workflow);
        return { handled: true, replies };
      }

      const step = workflow.currentStep;
      const media = input.mediaUrls ?? [];

      if (step === "photo" && media.length === 0 && isPhotoSkip(input.body)) {
        const q = enabledQuestions(client).find((x) => x.id === "photo");
        if (q && !q.required) {
          const next = nextCollectionStep(client, workflow.collected, "photo");
          workflow.currentStep = next;
          pushEvent(workflow, "photo_skipped", undefined, clock);
          if (next === "done") {
            await finalizeAndDispatch(workflow);
            return { handled: true, replies };
          }
          const prompt = await sendPrompt(workflow, client.id, next);
          if (prompt) replies.push(prompt);
          await deps.store.saveWorkflow(workflow);
          return { handled: true, replies };
        }
      }

      if (step === "photo" && media.length === 0 && !isPhotoSkip(input.body)) {
        const remind =
          workflow.collected.language === "en"
            ? "Please send a photo as an MMS image, or reply NO to skip."
            : "Envoyez une photo en MMS, ou répondez NON pour passer.";
        await deps.sms.send({
          toE164: input.fromE164,
          fromE164: client.smsFromNumber,
          body: remind,
        });
        replies.push(remind);
        await deps.store.saveWorkflow(workflow);
        return { handled: true, replies };
      }

      workflow.collected = applyAnswer(
        step,
        input.body,
        media,
        workflow.collected,
      );
      pushEvent(workflow, "answer_recorded", step, clock);

      if (step === "address") applyServiceArea(workflow, client);
      if (step === "description") applyUrgency(workflow, client);

      const next = nextCollectionStep(client, workflow.collected, step);
      workflow.currentStep = next;

      if (next === "done") {
        await finalizeAndDispatch(workflow);
        return { handled: true, replies };
      }

      const prompt = await sendPrompt(workflow, client.id, next);
      if (prompt) replies.push(prompt);
      await deps.store.saveWorkflow(workflow);
      return { handled: true, replies };
    },

    async processEscalations() {
      const escalated: string[] = [];
      const pending = await deps.store.listWorkflowsAwaitingTechnician();
      for (const workflow of pending) {
        const client = await deps.store.getClient(workflow.clientAccountId);
        if (!client) continue;
        const nextStage = shouldEscalate(workflow, client, clock.now());
        if (!nextStage) continue;
        await escalateWorkflow(workflow, nextStage);
        escalated.push(workflow.id);
      }
      return { escalated };
    },
  };
}
