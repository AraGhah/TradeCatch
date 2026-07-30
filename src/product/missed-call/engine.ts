import {
  buildDedupeKey,
  classifyCall,
  dedupeWindowBucket,
  shouldStartRecovery,
} from "./call-handling";
import {
  appendConversation,
  createLeadFromWorkflow,
  findOpenAlertForPhone,
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
  validateCollectionAnswer,
} from "./messaging";
import { checkServiceArea } from "./service-area";
import type { MissedCallStore } from "./store";
import {
  buildJobCardSms,
  createActionToken,
  getTechnicianChain,
  humanReviewAlertBody,
  parseTechnicianAction,
  resolveEscalationChain,
  shouldEscalateToIndex,
  stageForEscalationIndex,
  technicianAtEscalationIndex,
} from "./technicians";
import { classifyUrgency, rosterTechnician } from "./urgency";
import type {
  CallRecord,
  ClientAccount,
  Clock,
  CollectionStep,
  EscalationStage,
  MissedCallWorkflow,
  OutboundMessageRecord,
  SmsPort,
  TechnicianAlertRecord,
} from "./types";

const MAX_OUTBOUND_ATTEMPTS = 5;

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
    messageSid?: string;
  }): Promise<{ handled: boolean; replies: string[] }>;

  processEscalations(): Promise<{
    escalated: string[];
    timedOut: string[];
    outboxSent: number;
    outboxFailed: number;
  }>;
};

export function createMissedCallEngine(deps: {
  store: MissedCallStore;
  sms: SmsPort;
  clock?: Clock;
}): MissedCallEngine {
  const clock = deps.clock ?? { now: () => new Date() };
  /** Same-process claim so concurrent processEscalations ticks cannot double-alert. */
  const escalationLocks = new Set<string>();

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

  async function sendOutboundSms(input: {
    workflow: MissedCallWorkflow;
    client: ClientAccount;
    toE164: string;
    body: string;
    detail?: string;
    allowWhenSuppressed?: boolean;
  }): Promise<boolean> {
    if (
      !input.allowWhenSuppressed &&
      (await deps.store.isSmsSuppressed(input.client.id, input.toE164))
    ) {
      return false;
    }

    pushEvent(input.workflow, "sms_queued", input.detail, clock);
    await deps.store.saveWorkflow(input.workflow);

    const nowIso = clock.now().toISOString();
    const outbox: OutboundMessageRecord = {
      id: id("sms"),
      workflowId: input.workflow.id,
      clientAccountId: input.client.id,
      toE164: input.toE164,
      fromE164: input.client.smsFromNumber,
      body: input.body,
      detail: input.detail,
      // Queue first so a crash before send leaves a reclaimable row.
      status: "queued",
      attempts: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await deps.store.enqueueOutbound(outbox);

    const claimed = await deps.store.claimOutboundById(outbox.id);
    if (!claimed) {
      // Another worker already claimed this row — avoid double-send.
      return true;
    }

    try {
      const result = await deps.sms.send({
        toE164: input.toE164,
        fromE164: input.client.smsFromNumber,
        body: input.body,
      });
      await deps.store.markOutboundSent(outbox.id, result.sid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.store.markOutboundFailed(outbox.id, message, "retry");
      throw err;
    }

    pushEvent(input.workflow, "sms_sent", input.detail, clock);
    await logSmsConversation({
      workflow: input.workflow,
      direction: "outbound",
      fromE164: input.client.smsFromNumber,
      toE164: input.toE164,
      body: input.body,
      actor: "system",
    });
    await deps.store.saveWorkflow(input.workflow);
    return true;
  }

  async function flushOutboundQueue(): Promise<{
    sent: number;
    failed: number;
  }> {
    let sent = 0;
    let failed = 0;
    const batch = await deps.store.claimOutboundForSend(25);
    for (const msg of batch) {
      if (await deps.store.isSmsSuppressed(msg.clientAccountId, msg.toE164)) {
        await deps.store.markOutboundFailed(msg.id, "suppressed", "dead");
        failed += 1;
        continue;
      }
      try {
        const result = await deps.sms.send({
          toE164: msg.toE164,
          fromE164: msg.fromE164,
          body: msg.body,
        });
        await deps.store.markOutboundSent(msg.id, result.sid);
        if (msg.workflowId) {
          const wf = await deps.store.getWorkflow(msg.workflowId);
          if (wf) {
            const already = wf.events.some(
              (e) => e.type === "sms_sent" && e.detail === msg.detail,
            );
            if (!already) {
              pushEvent(wf, "sms_sent", msg.detail, clock);
              await deps.store.saveWorkflow(wf);
            }
          }
        }
        sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const next =
          msg.attempts + 1 >= MAX_OUTBOUND_ATTEMPTS ? "dead" : "retry";
        await deps.store.markOutboundFailed(msg.id, message, next);
        failed += 1;
      }
    }
    return { sent, failed };
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
    const sent = await sendOutboundSms({
      workflow,
      client,
      toE164: workflow.callerE164,
      body,
      detail: step,
    });
    return sent ? body : null;
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

  async function applyUrgency(
    workflow: MissedCallWorkflow,
    client: ClientAccount,
  ): Promise<void> {
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
    await ensureLead(workflow);
    const lead = await deps.store.getLeadByWorkflowId(workflow.id);
    if (lead) {
      logUrgencyOnLead(lead, log);
      await deps.store.saveLead(lead);
    }
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
    await sendOutboundSms({
      workflow,
      client,
      toE164: phone,
      body,
      detail: reason,
    });
    pushEvent(workflow, "human_review_alerted", reason, clock);
    workflow.status = "awaiting_human";
  }

  async function sendJobCard(
    workflow: MissedCallWorkflow,
    client: ClientAccount,
    escalationIndex: number,
  ): Promise<boolean> {
    const now = clock.now();
    if (!workflow.escalationChainIds?.length) {
      workflow.escalationChainIds = getTechnicianChain(client, now);
    }
    const tech = technicianAtEscalationIndex(
      client,
      escalationIndex,
      now,
      workflow.escalationChainIds,
    );
    if (!tech) return false;

    const chain = resolveEscalationChain(
      client,
      now,
      workflow.escalationChainIds,
    );
    const stage: EscalationStage = stageForEscalationIndex(
      escalationIndex,
      chain,
    );
    const actionToken = createActionToken();
    const body = buildJobCardSms({
      client,
      collected: workflow.collected,
      callerE164: workflow.callerE164,
      urgency: workflow.urgency,
      serviceAreaFlagged: workflow.serviceAreaFlagged,
      humanReviewRequired: workflow.humanReviewRequired,
      workflowId: workflow.id,
      actionToken,
    });

    const sentAt = now.toISOString();
    // Register the action token before send so outbox retries remain actionable.
    pushTechnicianAlert(
      workflow,
      {
        technicianId: tech.id,
        phone: tech.phone,
        sentAt,
        stage,
        actionToken,
      },
      escalationIndex,
    );
    pushEvent(workflow, "technician_alerted", `${stage}:${tech.id}`, clock);
    workflow.status = workflow.humanReviewRequired
      ? "awaiting_human"
      : "awaiting_technician";
    await deps.store.saveWorkflow(workflow);

    const sent = await sendOutboundSms({
      workflow,
      client,
      toE164: tech.phone,
      body,
      detail: `${stage}:${tech.id}`,
    });
    if (!sent) return false;

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

    const sent = await sendJobCard(workflow, client, 0);
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
    nextIndex: number | "exhausted",
  ): Promise<void> {
    const client = await deps.store.getClient(workflow.clientAccountId);
    if (!client) return;

    if (nextIndex === "exhausted") {
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

    const chain = resolveEscalationChain(
      client,
      clock.now(),
      workflow.escalationChainIds,
    );
    const stage = stageForEscalationIndex(nextIndex, chain);
    pushEvent(workflow, "escalation_timer", stage, clock);
    await sendJobCard(workflow, client, nextIndex);
    await deps.store.saveWorkflow(workflow);
    await ensureLead(workflow);
  }

  async function handleTechnicianSms(
    techWorkflow: MissedCallWorkflow,
    input: { fromE164: string; body: string },
    openAlert: TechnicianAlertRecord,
  ): Promise<{ handled: boolean; replies: string[] }> {
    const replies: string[] = [];
    const client = await deps.store.getClient(techWorkflow.clientAccountId);
    if (!client) return { handled: false, replies };

    const parsed = parseTechnicianAction(input.body);
    if (!parsed) {
      replies.push(
        `Répondez ACCEPTER ${openAlert.actionToken}, REFUSER ${openAlert.actionToken} ou APPELER ${openAlert.actionToken}.`,
      );
      return { handled: true, replies };
    }

    // Token is required once a job card was issued with a Code.
    if (
      !parsed.actionToken ||
      parsed.actionToken.toUpperCase() !== openAlert.actionToken.toUpperCase()
    ) {
      replies.push(
        `Code requis. Répondez ACCEPTER ${openAlert.actionToken} (ou REFUSER / APPELER + code).`,
      );
      return { handled: true, replies };
    }

    // Bind identity to the SMS sender's open alert — never to a stale assignee.
    if (openAlert.technicianId !== techWorkflow.assignedTechnicianId) {
      replies.push("Cette alerte n'est plus active. Attendez la fiche à jour.");
      return { handled: true, replies };
    }

    const tech =
      rosterTechnician(client, openAlert.technicianId) ??
      client.technicianRoster.find((t) => t.id === openAlert.technicianId) ??
      null;
    const action = parsed.action;

    if (action === "call") {
      markAlertResponse(
        techWorkflow,
        openAlert.technicianId,
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
      // Keep the alert open until customer notify succeeds so Twilio retries
      // and a second ACCEPTER remain actionable.
      techWorkflow.acceptNotifyPending = true;
      techWorkflow.assignedTechnicianId = openAlert.technicianId;
      pushEvent(techWorkflow, "technician_accepted", openAlert.technicianId, clock);
      await deps.store.saveWorkflow(techWorkflow);

      const notify = customerNotifyAccepted(
        client,
        techWorkflow.collected.language,
        tech?.name ?? "Le technicien",
      );
      let notified = false;
      try {
        notified = await sendOutboundSms({
          workflow: techWorkflow,
          client,
          toE164: techWorkflow.callerE164,
          body: notify,
          detail: "customer_notified",
        });
      } catch (err) {
        techWorkflow.acceptNotifyPending = true;
        await deps.store.saveWorkflow(techWorkflow);
        throw err;
      }
      if (!notified) {
        await deps.store.saveWorkflow(techWorkflow);
        await ensureLead(techWorkflow);
        replies.push(
          "Acceptation reçue, mais l'avis client a échoué. Réessayez ACCEPTER avec le même code, ou appelez le client.",
        );
        return { handled: true, replies };
      }

      markAlertResponse(
        techWorkflow,
        openAlert.technicianId,
        "accepted",
        clock.now(),
      );
      techWorkflow.acceptNotifyPending = false;
      const lead = await deps.store.getLeadByWorkflowId(techWorkflow.id);
      if (lead && techWorkflow.technicianAlertedAt) {
        recordTechnicianResponse(
          lead,
          techWorkflow.technicianAlertedAt,
          clock.now(),
          true,
        );
      }
      pushEvent(techWorkflow, "customer_notified", undefined, clock);
      techWorkflow.status = "completed";
      techWorkflow.stopReason = "completed";
      techWorkflow.outcome = "technician_accepted";
      pushEvent(techWorkflow, "outcome_recorded", "technician_accepted", clock);
      await deps.store.saveWorkflow(techWorkflow);
      await ensureLead(techWorkflow);
      replies.push("Demande acceptée. Le client a été avisé.");
      return { handled: true, replies };
    }

    if (action === "decline") {
      markAlertResponse(
        techWorkflow,
        openAlert.technicianId,
        "declined",
        clock.now(),
      );
      pushEvent(techWorkflow, "technician_declined", openAlert.technicianId, clock);
      const lead = await deps.store.getLeadByWorkflowId(techWorkflow.id);
      if (lead && techWorkflow.technicianAlertedAt) {
        recordTechnicianResponse(
          lead,
          techWorkflow.technicianAlertedAt,
          clock.now(),
          false,
        );
      }

      const chain = resolveEscalationChain(
        client,
        clock.now(),
        techWorkflow.escalationChainIds,
      );
      const next = techWorkflow.escalationIndex + 1;
      if (next >= chain.length) {
        await escalateWorkflow(techWorkflow, "exhausted");
        replies.push("Refus enregistré.");
        return { handled: true, replies };
      }
      await escalateWorkflow(techWorkflow, next);
      replies.push("Refus enregistré. Relais au prochain technicien.");
      return { handled: true, replies };
    }

    replies.push(
      `Répondez ACCEPTER ${openAlert.actionToken}, REFUSER ${openAlert.actionToken} ou APPELER ${openAlert.actionToken}.`,
    );
    return { handled: true, replies };
  }

  return {
    async handleCallEvent(input) {
      const client = await deps.store.getClient(input.clientAccountId);
      if (!client) {
        throw new Error(`Unknown client account: ${input.clientAccountId}`);
      }

      if (input.twilioCallSid) {
        const existingCall = await deps.store.findCallByTwilioSid(
          input.twilioCallSid,
        );
        if (existingCall) {
          // Twilio may retry after a failed opening SMS. If the workflow exists
          // but never recorded sms_sent for opening, retry delivery instead of
          // permanently dropping the recovery.
          const byCallId = await deps.store.findWorkflowByCallId(
            existingCall.id,
          );
          const active = await deps.store.findActiveWorkflowByCaller(
            existingCall.clientAccountId,
            existingCall.callerE164,
          );
          let wf =
            byCallId ??
            (active?.callId === existingCall.id
              ? active
              : await deps.store.findRecentWorkflowByCaller(
                  existingCall.clientAccountId,
                  existingCall.callerE164,
                  client.duplicateWindowMs,
                  clock.now(),
                ));

          // Call saved but workflow creation crashed — recreate recovery.
          if (!wf || wf.callId !== existingCall.id) {
            if (
              shouldStartRecovery(existingCall.disposition) &&
              !(await deps.store.isSmsSuppressed(
                client.id,
                existingCall.callerE164,
              ))
            ) {
              const now = clock.now().toISOString();
              const bucket = dedupeWindowBucket(
                new Date(existingCall.calledAt),
                client.duplicateWindowMs,
              );
              const dedupeKey = buildDedupeKey(
                client.id,
                existingCall.callerE164,
                bucket,
              );
              wf = {
                id: id("wf"),
                clientAccountId: client.id,
                callId: existingCall.id,
                callerE164: existingCall.callerE164,
                status: "awaiting_customer",
                currentStep: "language",
                collected: { language: "fr", photoUrls: [] },
                escalationIndex: -1,
                escalationStage: "primary",
                technicianAlerts: [],
                outcome: "open",
                events: [],
                createdAt: now,
                updatedAt: now,
                dedupeKey,
                collectionStartedAt: now,
              };
              pushEvent(
                wf,
                "workflow_started",
                existingCall.disposition,
                clock,
              );
              await deps.store.saveWorkflow(wf);
              const open = openingSms(client);
              const smsSent = await sendOutboundSms({
                workflow: wf,
                client,
                toE164: wf.callerE164,
                body: open,
                detail: "opening_fr",
              });
              return {
                call: existingCall,
                workflow: wf,
                smsSent,
                suppressedReason: smsSent
                  ? undefined
                  : "opening_sms_retry_suppressed",
              };
            }
            return {
              call: existingCall,
              workflow: null,
              smsSent: false,
              suppressedReason: "duplicate_call_sid",
            };
          }

          if (
            !wf.events.some(
              (e) => e.type === "sms_sent" && e.detail === "opening_fr",
            )
          ) {
            const open = openingSms(client);
            const smsSent = await sendOutboundSms({
              workflow: wf,
              client,
              toE164: wf.callerE164,
              body: open,
              detail: "opening_fr",
            });
            return {
              call: existingCall,
              workflow: wf,
              smsSent,
              suppressedReason: smsSent
                ? undefined
                : "opening_sms_retry_suppressed",
            };
          }
          return {
            call: existingCall,
            workflow: wf,
            smsSent: false,
            suppressedReason: "duplicate_call_sid",
          };
        }
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

      if (await deps.store.isSmsSuppressed(client.id, input.callerE164)) {
        return {
          call,
          workflow: null,
          smsSent: false,
          suppressedReason: "opt_out",
        };
      }

      const recent = await deps.store.findRecentWorkflowByCaller(
        client.id,
        input.callerE164,
        client.duplicateWindowMs,
        clock.now(),
      );
      if (recent) {
        pushEvent(recent, "duplicate_call_suppressed", call.id, clock);
        await deps.store.saveWorkflow(recent);
        return {
          call,
          workflow: recent,
          smsSent: false,
          suppressedReason: "duplicate_suppressed",
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
        escalationIndex: -1,
        escalationStage: "primary",
        technicianAlerts: [],
        outcome: "open",
        events: [],
        createdAt: now,
        updatedAt: now,
        dedupeKey,
        collectionStartedAt: now,
      };
      pushEvent(workflow, "workflow_started", disposition, clock);
      await deps.store.saveWorkflow(workflow);

      const open = openingSms(client);
      const smsSent = await sendOutboundSms({
        workflow,
        client,
        toE164: input.callerE164,
        body: open,
        detail: "opening_fr",
      });

      return { call, workflow, smsSent };
    },

    async handleInboundSms(input) {
      const replies: string[] = [];
      let claimedSid: string | undefined;

      try {
      if (input.messageSid) {
        const claimed = await deps.store.claimInboundMessageSid(
          input.messageSid,
        );
        if (!claimed) {
          return { handled: true, replies: [] };
        }
        claimedSid = input.messageSid;
      }

      const client = await deps.store.findClientBySmsFromNumber(input.toE164);

      // Opt-out / STOP must run before technician command routing so a tech
      // (or customer) replying STOP is suppressed, not told "invalid command".
      if (client && isOptOut(input.body, client)) {
        let providerStatus: "local_only" | "synced" | "pending" | "error" =
          "local_only";
        let providerDetail: string | undefined;
        if (deps.sms.syncOptOut) {
          const sync = await deps.sms.syncOptOut({
            phoneE164: input.fromE164,
            fromE164: client.smsFromNumber,
          });
          // syncOptOut is currently a local observation helper — never claim
          // provider sync until a real Twilio Messaging Opt-Out API is wired.
          providerStatus = sync.ok ? "local_only" : "error";
          providerDetail = sync.detail ?? "provider_sync_not_implemented";
        }

        await deps.store.addSmsSuppression({
          clientAccountId: client.id,
          phoneE164: input.fromE164,
          channel: "sms",
          source: "customer_keyword",
          at: clock.now().toISOString(),
          providerStatus,
          providerDetail,
        });

        const wf = await deps.store.findActiveWorkflowByCaller(
          client.id,
          input.fromE164,
        );
        const bye =
          "Vous êtes désabonné. Vous ne recevrez plus de textos de notre part. / You are unsubscribed.";
        if (wf) {
          wf.status = "stopped";
          wf.stopReason = "opt_out";
          wf.outcome = "cancelled";
          pushEvent(wf, "opt_out", undefined, clock);
          pushEvent(wf, "outcome_recorded", "cancelled", clock);
          await deps.store.saveWorkflow(wf);
          await ensureLead(wf);
          await sendOutboundSms({
            workflow: wf,
            client,
            toE164: input.fromE164,
            body: bye,
            detail: "opt_out_confirm",
            allowWhenSuppressed: true,
          });
        } else {
          await deps.sms.send({
            toE164: input.fromE164,
            fromE164: client.smsFromNumber,
            body: bye,
          });
        }
        return { handled: true, replies };
      }

      const parsedEarly = parseTechnicianAction(input.body);
      const techWorkflow = await deps.store.findWorkflowByTechnicianPhone(
        input.fromE164,
        parsedEarly?.actionToken,
      );
      if (techWorkflow) {
        const openAlert = findOpenAlertForPhone(
          techWorkflow,
          input.fromE164,
          parsedEarly?.actionToken,
        );
        if (openAlert) {
          return handleTechnicianSms(techWorkflow, input, openAlert);
        }
      }

      // Known technician phone with only timed-out / wrong-code alerts.
      const awaiting = await deps.store.listWorkflowsAwaitingTechnician();
      const staleTech = awaiting.some((w) =>
        w.technicianAlerts.some((a) => a.phone === input.fromE164),
      );
      if (staleTech) {
        return {
          handled: true,
          replies: [
            "Cette alerte n'est plus active. Répondez uniquement à la fiche job la plus récente (avec son code).",
          ],
        };
      }

      if (!client) return { handled: false, replies };

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
      const question = enabledQuestions(client).find((x) => x.id === step);

      if (step === "photo" && media.length === 0 && isPhotoSkip(input.body)) {
        if (question?.required) {
          const message =
            workflow.collected.language === "en"
              ? "A photo is required. Please send an MMS image."
              : "Une photo est requise. Envoyez une image en MMS.";
          await sendOutboundSms({
            workflow,
            client,
            toE164: input.fromE164,
            body: message,
            detail: "photo_required",
          });
          replies.push(message);
          await deps.store.saveWorkflow(workflow);
          return { handled: true, replies };
        }
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

      const validation = validateCollectionAnswer({
        step,
        body: input.body,
        mediaUrls: media,
        question,
        lang: workflow.collected.language,
      });
      if (!validation.ok) {
        await sendOutboundSms({
          workflow,
          client,
          toE164: input.fromE164,
          body: validation.message,
          detail: `validation_failed:${step}`,
        });
        replies.push(validation.message);
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
      if (step === "description") await applyUrgency(workflow, client);

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
      } catch (err) {
        if (claimedSid) {
          await deps.store.releaseInboundMessageSid(claimedSid);
        }
        throw err;
      }
    },

    async processEscalations() {
      const escalated: string[] = [];
      const timedOut: string[] = [];
      const now = clock.now();
      const outbox = await flushOutboundQueue();

      const awaitingCustomer = await deps.store.listWorkflowsAwaitingCustomer();
      for (const workflow of awaitingCustomer) {
        const client = await deps.store.getClient(workflow.clientAccountId);
        if (!client) continue;
        const startedAt = workflow.collectionStartedAt ?? workflow.createdAt;
        const limitMs =
          client.timeouts?.customerCollectionMs ?? 2 * 60 * 60 * 1000;
        if (now.getTime() - new Date(startedAt).getTime() <= limitMs) {
          continue;
        }
        workflow.status = "stopped";
        workflow.stopReason = "customer_timeout";
        workflow.outcome = "customer_unreachable";
        pushEvent(workflow, "customer_collection_timeout", undefined, clock);
        pushEvent(workflow, "outcome_recorded", "customer_unreachable", clock);
        await deps.store.saveWorkflow(workflow);
        await ensureLead(workflow);
        timedOut.push(workflow.id);
      }

      const pending = await deps.store.listWorkflowsAwaitingTechnician();
      const ESCALATION_LEASE_MS = 60_000;
      for (const workflow of pending) {
        if (escalationLocks.has(workflow.id)) continue;
        escalationLocks.add(workflow.id);
        try {
          const claimed = await deps.store.claimWorkflowEscalation(
            workflow.id,
            ESCALATION_LEASE_MS,
            now,
          );
          if (!claimed) continue;
          try {
            const client = await deps.store.getClient(claimed.clientAccountId);
            if (!client) continue;
            const nextIndex = shouldEscalateToIndex(claimed, client, now);
            if (nextIndex === null) continue;
            await escalateWorkflow(claimed, nextIndex);
            escalated.push(claimed.id);
          } finally {
            // Release lease after the tick so later timer-based escalations
            // are not blocked for the full lease window.
            const latest = await deps.store.getWorkflow(workflow.id);
            if (latest?.escalationClaimUntil) {
              latest.escalationClaimUntil = undefined;
              await deps.store.saveWorkflow(latest);
            }
          }
        } finally {
          escalationLocks.delete(workflow.id);
        }
      }
      return {
        escalated,
        timedOut,
        outboxSent: outbox.sent,
        outboxFailed: outbox.failed,
      };
    },
  };
}
