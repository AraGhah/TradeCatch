/**
 * SMS receptionist — answers customers who text a business number first.
 *
 * Runs only after Module A (STOP, technician commands, an active missed-call
 * workflow) has declined the message, so it never competes with those flows.
 * Everything with side effects is injected: tests exercise the whole decision
 * tree without a database, Twilio or a model.
 *
 * Logging carries organization/client ids, the message SID and reason codes
 * only — never phone numbers, message text, or provider error text.
 */

import {
  parseTimePreference,
  pickOffers,
  type OpenSlot,
  type ReceptionistScheduler,
} from "@/product/receptionist/booking";
import type { LlmClient } from "@/product/receptionist/llm";
import type { ReceptionistConfig } from "@/product/receptionist/types";
import { classifyUrgency } from "@/product/missed-call/urgency";
import { SmsDeliveryError } from "@/product/missed-call/twilio";
import type {
  ClientAccount,
  OutboundMessageRecord,
  OutboundSms,
} from "@/product/missed-call/types";
import { isInsideSendingWindow } from "@/product/sms-automation/window";
import {
  afterHoursReply,
  bookingConfirmation,
  buildSystemPrompt,
  buildUserPrompt,
  conversationLanguage,
  criticalSafetyReply,
  fallbackReply,
  followUpReply,
  isFallbackReply,
  isFollowUpReply,
  parseModelReply,
  replyIsSendable,
  requestReply,
  REPLY_SCHEMA,
  rulesReply,
  sanitizeReply,
  slotTakenReply,
  type BusinessContext,
  type HistoryTurn,
  type ModelReply,
  type SmsLanguage,
} from "./reply";

export const SMS_RECEPTIONIST_EVENT_PREFIX = "tradecatch.sms_receptionist.";

/** Automated replies to one customer within a rolling hour, to stop loops. */
export const MAX_AUTO_REPLIES_PER_HOUR = 20;
/**
 * "We got it" replies in a row before the line goes quiet (the team is still
 * alerted). Enough that a customer never meets a dead line, few enough that
 * "??" "???" cannot ping-pong with an automated loop.
 */
export const MAX_CONSECUTIVE_FOLLOW_UPS = 2;
const HISTORY_LIMIT = 60;
const PROMPT_HISTORY_LIMIT = 40;
const OPENINGS_TIMEOUT_MS = 3_500;
const OPENINGS_HORIZON_DAYS = 7;
const DEFAULT_LANGUAGE: SmsLanguage = "fr";

export type SkipReason =
  | "missing_message_sid"
  | "empty_body"
  | "organization_inactive"
  | "not_entitled"
  | "disabled"
  | "paused"
  | "staff_sender"
  | "suppressed"
  | "active_workflow"
  | "quote_thread"
  | "rate_limited"
  | "fallback_already_sent"
  | "duplicate"
  | "persistence_failed"
  | "unexpected_error";

export type SmsReceptionistResult =
  | { status: "skipped"; reason: SkipReason }
  | {
      status: "replied";
      outboxId: string;
      /** False when Twilio rejected it and the outbox will retry. */
      sent: boolean;
      action: "reply" | "book" | "escalate";
      source: "model" | "fallback" | "safety" | "booking" | "rules";
      booked: boolean;
      escalated: boolean;
    };

export type SmsReceptionistInput = {
  organizationId: string;
  client: ClientAccount;
  fromE164: string;
  toE164: string;
  body: string;
  messageSid: string;
  /** CRM conversation is not `ai_managed`. */
  paused: boolean;
  /**
   * An active quote follow-up thread existed for this sender. Read before the
   * quote dispatcher runs: replying stops the thread, which would hide it here.
   */
  quoteThreadActive: boolean;
};

export type HistoryMessage = {
  direction: "inbound" | "outbound";
  body: string;
  at: string;
  providerMessageSid?: string;
  automated?: boolean;
};

export type EscalationReason =
  | "urgent"
  | "customer_request"
  | "ai_unavailable"
  | "booking_unconfirmed"
  | "quiet_hours";

export type SmsReceptionistDeps = {
  now(): Date;
  getOrganization(
    id: string,
  ): Promise<{ status: string; entitled: boolean } | null>;
  /** Opt-out in either the Module A or the SMS-automation suppression list. */
  isSuppressed(input: {
    organizationId: string;
    clientId: string;
    phoneE164: string;
  }): Promise<boolean>;
  /**
   * The customer's open missed-call workflow, if any. "collecting": Module A is
   * asking this customer its intake questions and owns the reply. "with_team":
   * the intake is done and the request is with a technician or a person, so
   * nobody else will answer a new text.
   */
  activeWorkflow(
    clientId: string,
    phoneE164: string,
  ): Promise<"collecting" | "with_team" | null>;
  quietHours(organizationId: string): Promise<{
    windowStartHour: number;
    windowEndHour: number;
    weekendSending: boolean;
  }>;
  history(
    organizationId: string,
    phoneE164: string,
    limit: number,
  ): Promise<HistoryMessage[]>;
  loadBusiness(client: ClientAccount): Promise<{
    context: BusinessContext;
    /** Present only when the business opted in to booking by text. */
    bookingConfig?: ReceptionistConfig;
  }>;
  scheduler: ReceptionistScheduler | null;
  llm: LlmClient | null;
  outbox: {
    enqueue(message: OutboundMessageRecord): Promise<void>;
    claim(id: string): Promise<OutboundMessageRecord | null>;
    markSent(id: string, providerSid: string): Promise<void>;
    markFailed(id: string, error: string, cause?: unknown): Promise<void>;
  };
  sendSms(message: OutboundSms): Promise<{ sid: string }>;
  recordOutbound(input: {
    organizationId: string;
    customerE164: string;
    businessE164: string;
    body: string;
    sent: boolean;
    providerSid?: string;
    outboxId?: string;
  }): Promise<void>;
  escalate(input: {
    organizationId: string;
    client: ClientAccount;
    customerE164: string;
    messageSid: string;
    reason: EscalationReason;
    /** False when the team was already alerted for this conversation. */
    alertStaff: boolean;
    /** Hand the conversation to a human (stops further AI replies). */
    handOff: boolean;
  }): Promise<void>;
  log(event: string, fields: Record<string, unknown>): void;
};

function digitsOnly(value: string): string {
  const d = value.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function samePhone(a: string, b: string): boolean {
  return digitsOnly(a) !== "" && digitsOnly(a) === digitsOnly(b);
}

/** Error class/code only: provider messages can contain phone numbers. */
function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; code?: unknown; status?: unknown };
    const code = e.code ?? e.status;
    const name = typeof e.name === "string" ? e.name : "Error";
    return code !== undefined ? `${name}:${String(code)}` : name;
  }
  return "Error";
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createSmsReceptionist(deps: SmsReceptionistDeps) {
  async function handleCustomerSms(
    input: SmsReceptionistInput,
  ): Promise<SmsReceptionistResult> {
    const base = {
      organizationId: input.organizationId,
      clientId: input.client.id,
      messageSid: input.messageSid,
    };
    const started = Date.now();
    const skip = (
      reason: SkipReason,
      extra: Record<string, unknown> = {},
    ): SmsReceptionistResult => {
      deps.log("skipped", { ...base, reason, ...extra });
      return { status: "skipped", reason };
    };

    try {
      deps.log("received", base);
      if (!input.messageSid) return skip("missing_message_sid");
      if (!input.body.trim()) return skip("empty_body");

      const org = await deps.getOrganization(input.organizationId);
      if (!org || org.status !== "active") return skip("organization_inactive");
      if (!org.entitled) return skip("not_entitled");
      if (input.client.aiSmsReplies === false) return skip("disabled");
      if (input.paused) return skip("paused");

      const { client } = input;
      const staffPhones = [
        ...client.technicianRoster.map((t) => t.phone),
        ...(client.humanReviewPhone ? [client.humanReviewPhone] : []),
      ];
      if (staffPhones.some((phone) => samePhone(phone, input.fromE164))) {
        return skip("staff_sender");
      }

      if (
        await deps.isSuppressed({
          organizationId: input.organizationId,
          clientId: client.id,
          phoneE164: input.fromE164,
        })
      ) {
        return skip("suppressed");
      }
      const workflow = await deps.activeWorkflow(client.id, input.fromE164);
      if (workflow === "collecting") return skip("active_workflow");
      const openRequest = workflow === "with_team";
      if (input.quoteThreadActive) return skip("quote_thread");

      const now = deps.now();
      const window = await deps.quietHours(input.organizationId);
      const insideWindow = isInsideSendingWindow(now, client.timezone, window);

      const history = await deps.history(
        input.organizationId,
        input.fromE164,
        HISTORY_LIMIT,
      );
      const earlier = history.filter(
        (m) => m.providerMessageSid !== input.messageSid,
      );
      const hourAgo = now.getTime() - 60 * 60_000;
      const recentAutomated = earlier.filter(
        (m) =>
          m.direction === "outbound" &&
          m.automated &&
          Date.parse(m.at) >= hourAgo,
      ).length;
      if (recentAutomated >= MAX_AUTO_REPLIES_PER_HOUR) {
        return skip("rate_limited");
      }

      const turns: HistoryTurn[] = earlier
        .slice(-PROMPT_HISTORY_LIMIT)
        .map((m) => ({
          role: m.direction === "inbound" ? "customer" : "assistant",
          text: m.body,
        }));
      const language = conversationLanguage(
        turns,
        input.body,
        DEFAULT_LANGUAGE,
      );

      const { context, bookingConfig } = await deps.loadBusiness(client);
      deps.log("business_identified", {
        ...base,
        language,
        bookingEnabled: Boolean(bookingConfig && deps.scheduler),
      });

      // Danger first: a fixed safety message, no model, no booking.
      const urgency = classifyUrgency({
        issueDescription: input.body,
        rubric: client.urgencyRubric,
        at: now,
      }).classification;
      if (urgency.level === "critical") {
        deps.log("workflow_selected", { ...base, workflow: "safety" });
        return await deliver(input, {
          body: criticalSafetyReply(language, context),
          action: "escalate",
          source: "safety",
          language,
          escalate: { reason: "urgent", alertStaff: true, handOff: true },
        });
      }

      deps.log("workflow_selected", { ...base, workflow: "conversation" });

      const openings = await loadOpenings({
        input,
        context,
        bookingConfig,
        history: turns,
        language,
        now,
      });

      const alreadyAcknowledged = turns.some(
        (t) =>
          t.role === "assistant" &&
          (isFallbackReply(t.text, context) ||
            isFollowUpReply(t.text, context)),
      );
      // Nothing new to say: a short "we got it" rather than silence.
      const followUp = (reason: EscalationReason) =>
        sendFollowUp(input, { context, language, turns, openRequest, reason });

      // Outside the owner's sending window: still answer (customers text
      // after hours expecting a reply) with a closed-hours script or rules
      // brain — never go fully silent. Staff get an inbox item, not a wake-up SMS.
      if (!insideWindow && !deps.llm) {
        if (openRequest) return await followUp("quiet_hours");
        const specific = rulesReply({
          body: input.body,
          language,
          context,
          history: turns,
          alreadyAcknowledged,
          specificOnly: true,
        });
        const afterHoursDraft = specific
          ? specific
          : alreadyAcknowledged
            ? null
            : {
                reply: afterHoursReply(language, context),
                action: "escalate" as const,
                language,
              };
        if (!afterHoursDraft) return await followUp("quiet_hours");
        deps.log("reply_generated", {
          ...base,
          action: afterHoursDraft.action,
          language: afterHoursDraft.language,
          source: "rules",
          quietHours: true,
        });
        const text =
          sanitizeReply(afterHoursDraft.reply) ??
          afterHoursReply(language, context);
        return await deliver(input, {
          body: text,
          action: afterHoursDraft.action === "escalate" ? "escalate" : "reply",
          source: "rules",
          language: afterHoursDraft.language,
          escalate: {
            reason: "quiet_hours",
            alertStaff: false,
            handOff: false,
          },
        });
      }

      let draft: ModelReply | null = null;
      let draftSource: "model" | "rules" | "fallback" = "fallback";
      if (deps.llm) {
        try {
          draft = parseModelReply(
            await deps.llm.generateJson({
              system: buildSystemPrompt(context),
              user: buildUserPrompt({
                context: { ...context, timezone: openings.timezone },
                history: turns,
                body: input.body,
                language,
                slots: openings.offered,
                now,
                openRequest,
              }),
              schema: REPLY_SCHEMA as unknown as Record<string, unknown>,
              maxTokens: 500,
            }),
          );
          if (draft) draftSource = "model";
          else deps.log("ai_failed", { ...base, reason: "invalid_output" });
        } catch (err) {
          deps.log("ai_failed", { ...base, reason: errorCode(err) });
        }
      }

      if (!draft && openRequest) {
        // The rules brain would ask again for the name and address the team
        // already has; acknowledge instead and leave the answer to a person.
        return await followUp("customer_request");
      }
      if (!draft) {
        draft = rulesReply({
          body: input.body,
          language,
          context,
          history: turns,
          alreadyAcknowledged,
        });
        if (draft) {
          draftSource = isFallbackReply(draft.reply, context)
            ? "fallback"
            : "rules";
        }
      }

      if (!draft) {
        // Rules brain had nothing new to say (generic ack already sent).
        return await followUp("ai_unavailable");
      }

      deps.log("reply_generated", {
        ...base,
        action: draft.action,
        language: draft.language,
        source: draftSource,
      });
      const replyLanguage = draft.language;

      if (draft.action === "book" && draftSource === "model") {
        return await completeBooking({
          input,
          context,
          bookingConfig,
          draft,
          openings,
          language: replyLanguage,
        });
      }

      const text = sanitizeReply(draft.reply);
      if (!text || !replyIsSendable(text)) {
        // The model claimed a booking nobody made (or wrote nothing usable).
        deps.log("reply_rejected", {
          ...base,
          reason: text ? "unbacked_booking_claim" : "empty",
        });
        const rules = rulesReply({
          body: input.body,
          language: replyLanguage,
          context,
          history: turns,
          alreadyAcknowledged,
        });
        if (!rules) return await followUp("ai_unavailable");
        const rulesText =
          sanitizeReply(rules.reply) ?? fallbackReply(replyLanguage, context);
        const rulesSource = isFallbackReply(rulesText, context)
          ? "fallback"
          : "rules";
        return await deliver(input, {
          body: rulesText,
          action: rules.action === "escalate" ? "escalate" : "reply",
          source: rulesSource,
          language: replyLanguage,
          escalate: {
            reason: "ai_unavailable",
            alertStaff: rulesSource === "fallback",
            handOff: false,
          },
        });
      }

      const escalate =
        draft.action === "escalate" || urgency.level === "priority";
      return await deliver(input, {
        body: text,
        action: escalate ? "escalate" : "reply",
        source: draftSource,
        language: replyLanguage,
        escalate: escalate
          ? {
              reason:
                urgency.level === "priority"
                  ? "urgent"
                  : draftSource === "fallback"
                    ? "ai_unavailable"
                    : "customer_request",
              alertStaff: true,
              handOff: draft.action === "escalate" && draftSource === "model",
            }
          : undefined,
      });
    } catch (err) {
      deps.log("failed", { ...base, reason: errorCode(err) });
      return { status: "skipped", reason: "unexpected_error" };
    } finally {
      deps.log("processed", { ...base, processingMs: Date.now() - started });
    }
  }

  async function loadOpenings(args: {
    input: SmsReceptionistInput;
    context: BusinessContext;
    bookingConfig: ReceptionistConfig | undefined;
    history: HistoryTurn[];
    language: SmsLanguage;
    now: Date;
  }): Promise<{
    timezone: string;
    offered: OpenSlot[];
    all: OpenSlot[];
    serviceId?: string;
    serviceName?: string;
  }> {
    const none = {
      timezone: args.context.timezone,
      offered: [],
      all: [],
    };
    if (!deps.scheduler || !args.bookingConfig) return none;
    try {
      const customerText = [
        ...args.history.filter((t) => t.role === "customer").map((t) => t.text),
        args.input.body,
      ].join(" ");
      const result = await withTimeout(
        deps.scheduler.listOpenings({
          config: args.bookingConfig,
          issue: customerText,
          language: args.language,
          from: args.now,
          until: new Date(
            args.now.getTime() + OPENINGS_HORIZON_DAYS * 24 * 60 * 60_000,
          ),
        }),
        OPENINGS_TIMEOUT_MS,
      );
      if (!result.ok) return none;
      const preference = parseTimePreference(
        args.input.body,
        args.now,
        result.timezone,
      );
      return {
        timezone: result.timezone,
        offered: pickOffers(result.slots, preference, result.timezone).picks,
        all: result.slots,
        serviceId: result.service.id,
        serviceName: result.service.name,
      };
    } catch (err) {
      // No availability read means no times are offered, and nothing is booked.
      deps.log("availability_failed", {
        organizationId: args.input.organizationId,
        messageSid: args.input.messageSid,
        reason: errorCode(err),
      });
      return none;
    }
  }

  async function completeBooking(args: {
    input: SmsReceptionistInput;
    context: BusinessContext;
    bookingConfig: ReceptionistConfig | undefined;
    draft: ModelReply;
    openings: Awaited<ReturnType<typeof loadOpenings>>;
    language: SmsLanguage;
  }): Promise<SmsReceptionistResult> {
    const { input, context, bookingConfig, draft, openings, language } = args;
    const base = {
      organizationId: input.organizationId,
      clientId: input.client.id,
      messageSid: input.messageSid,
    };
    const offered = new Set(openings.all.map((s) => s.startAt));
    const startAt = draft.bookStartAt;

    const ask = (body: string) =>
      deliver(input, {
        body,
        action: "reply",
        source: "model",
        language,
      });

    if (
      !deps.scheduler ||
      !bookingConfig ||
      !startAt ||
      !offered.has(startAt)
    ) {
      // The model picked a time that was never offered (or booking is off).
      deps.log("booking_rejected", { ...base, reason: "time_not_offered" });
      if (openings.offered.length > 0) {
        return ask(
          slotTakenReply(openings.offered, openings.timezone, language),
        );
      }
      return deliver(input, {
        body: requestReply(language),
        action: "escalate",
        source: "booking",
        language,
        escalate: {
          reason: "booking_unconfirmed",
          alertStaff: true,
          handOff: false,
        },
      });
    }

    if (!draft.customerName || !draft.serviceAddress) {
      deps.log("booking_rejected", { ...base, reason: "missing_details" });
      return ask(
        language === "fr"
          ? "Parfait pour cette heure! Pour réserver, j’ai besoin de votre nom et de l’adresse où nous devons passer."
          : "That time works! To book it I need your name and the address where we should come.",
      );
    }

    const result = await deps.scheduler.reserve({
      config: bookingConfig,
      serviceId: openings.serviceId,
      serviceName: draft.service ?? openings.serviceName,
      startAt,
      callerName: draft.customerName,
      callbackE164: input.fromE164,
      serviceAddress: draft.serviceAddress,
      language,
      idempotencyKey: `sms:${input.organizationId}:${digitsOnly(input.fromE164)}:${startAt}`,
    });

    if (result.status === "confirmed") {
      deps.log("booking_confirmed", base);
      return deliver(input, {
        body: bookingConfirmation(
          result.startAt,
          openings.timezone,
          language,
          context,
        ),
        action: "book",
        source: "booking",
        language,
        booked: true,
      });
    }
    if (result.status === "conflict" && result.alternatives.length > 0) {
      deps.log("booking_conflict", base);
      return ask(
        slotTakenReply(result.alternatives, openings.timezone, language),
      );
    }
    deps.log("booking_unconfirmed", {
      ...base,
      reason: result.status === "request" ? result.reason : result.status,
    });
    return deliver(input, {
      body: requestReply(language),
      action: "escalate",
      source: "booking",
      language,
      escalate: {
        reason: "booking_unconfirmed",
        alertStaff: true,
        handOff: false,
      },
    });
  }

  async function sendFollowUp(
    input: SmsReceptionistInput,
    args: {
      context: BusinessContext;
      language: SmsLanguage;
      turns: HistoryTurn[];
      openRequest: boolean;
      reason: EscalationReason;
    },
  ): Promise<SmsReceptionistResult> {
    let streak = 0;
    for (let i = args.turns.length - 1; i >= 0; i -= 1) {
      const turn = args.turns[i]!;
      if (turn.role !== "assistant") continue;
      if (!isFollowUpReply(turn.text, args.context)) break;
      streak += 1;
    }
    if (streak >= MAX_CONSECUTIVE_FOLLOW_UPS) {
      // Still never lost: the team gets the conversation in its inbox.
      await safeEscalate(input, args.reason, false, false);
      deps.log("skipped", {
        organizationId: input.organizationId,
        clientId: input.client.id,
        messageSid: input.messageSid,
        reason: "fallback_already_sent",
      });
      return { status: "skipped", reason: "fallback_already_sent" };
    }
    deps.log("reply_generated", {
      organizationId: input.organizationId,
      clientId: input.client.id,
      messageSid: input.messageSid,
      action: "escalate",
      language: args.language,
      source: "rules",
      followUp: true,
    });
    return deliver(input, {
      body: followUpReply(args.language, args.context, args.openRequest),
      action: "escalate",
      source: "rules",
      language: args.language,
      escalate: { reason: args.reason, alertStaff: false, handOff: false },
    });
  }

  async function safeEscalate(
    input: SmsReceptionistInput,
    reason: EscalationReason,
    alertStaff: boolean,
    handOff: boolean,
  ): Promise<boolean> {
    try {
      await deps.escalate({
        organizationId: input.organizationId,
        client: input.client,
        customerE164: input.fromE164,
        messageSid: input.messageSid,
        reason,
        alertStaff,
        handOff,
      });
      deps.log("escalated", {
        organizationId: input.organizationId,
        clientId: input.client.id,
        messageSid: input.messageSid,
        reason,
        alertStaff,
        handOff,
      });
      return true;
    } catch (err) {
      deps.log("escalation_failed", {
        organizationId: input.organizationId,
        clientId: input.client.id,
        messageSid: input.messageSid,
        reason: errorCode(err),
      });
      return false;
    }
  }

  async function deliver(
    input: SmsReceptionistInput,
    out: {
      body: string;
      action: "reply" | "book" | "escalate";
      source: "model" | "fallback" | "safety" | "booking" | "rules";
      language: SmsLanguage;
      booked?: boolean;
      escalate?: {
        reason: EscalationReason;
        alertStaff: boolean;
        handOff: boolean;
      };
    },
  ): Promise<SmsReceptionistResult> {
    const base = {
      organizationId: input.organizationId,
      clientId: input.client.id,
      messageSid: input.messageSid,
    };
    const outboxId = `smsrep_${input.messageSid}`;
    const nowIso = deps.now().toISOString();

    try {
      await deps.outbox.enqueue({
        id: outboxId,
        clientAccountId: input.client.id,
        toE164: input.fromE164,
        fromE164: input.client.smsFromNumber,
        body: out.body,
        detail: "sms_receptionist",
        status: "queued",
        attempts: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } catch (err) {
      deps.log("db_failed", {
        ...base,
        stage: "enqueue",
        reason: errorCode(err),
      });
      // Nothing was sent: make sure a person sees the customer's text.
      await safeEscalate(input, "ai_unavailable", true, false);
      return { status: "skipped", reason: "persistence_failed" };
    }
    deps.log("queued", { ...base, source: out.source });

    let claimed: OutboundMessageRecord | null;
    try {
      claimed = await deps.outbox.claim(outboxId);
    } catch (err) {
      deps.log("db_failed", {
        ...base,
        stage: "claim",
        reason: errorCode(err),
      });
      // The row is queued; the outbox flush will send it.
      return replied(false);
    }
    if (!claimed) {
      // Another delivery already owns this reply (replay or flush).
      return { status: "skipped", reason: "duplicate" };
    }

    try {
      await deps.recordOutbound({
        organizationId: input.organizationId,
        customerE164: input.fromE164,
        businessE164: claimed.fromE164,
        body: claimed.body,
        sent: false,
        outboxId,
      });
    } catch (error) {
      // No provider request was made; retry after history storage recovers.
      await deps.outbox.markFailed(
        outboxId,
        "history_unavailable",
        new SmsDeliveryError("retry", "history_unavailable"),
      );
      throw error;
    }

    let sent = false;
    let providerSid: string | undefined;
    try {
      const result = await deps.sendSms({
        toE164: claimed.toE164,
        fromE164: claimed.fromE164,
        body: claimed.body,
        outboxId,
      });
      sent = true;
      try {
        await deps.outbox.markSent(outboxId, result.sid);
      } catch (err) {
        // Twilio accepted it. A DB failure is not permission to send it again.
        deps.log("db_failed", {
          ...base,
          stage: "mark_sent",
          reason: errorCode(err),
        });
      }
      providerSid = result.sid;
      deps.log("sent", base);
    } catch (err) {
      deps.log("send_failed", { ...base, reason: errorCode(err) });
      try {
        await deps.outbox.markFailed(outboxId, errorCode(err), err);
      } catch (markErr) {
        deps.log("db_failed", {
          ...base,
          stage: "mark_failed",
          reason: errorCode(markErr),
        });
      }
    }

    try {
      await deps.recordOutbound({
        organizationId: input.organizationId,
        customerE164: input.fromE164,
        businessE164: input.client.smsFromNumber,
        body: claimed.body,
        sent,
        providerSid,
        outboxId,
      });
    } catch (err) {
      deps.log("db_failed", { ...base, stage: "crm", reason: errorCode(err) });
    }

    const escalated = out.escalate
      ? await safeEscalate(
          input,
          out.escalate.reason,
          out.escalate.alertStaff,
          out.escalate.handOff,
        )
      : false;
    return replied(sent, escalated);

    function replied(
      wasSent: boolean,
      wasEscalated = false,
    ): SmsReceptionistResult {
      return {
        status: "replied",
        outboxId,
        sent: wasSent,
        action: out.action,
        source: out.source,
        booked: Boolean(out.booked),
        escalated: wasEscalated,
      };
    }
  }

  return { handleCustomerSms };
}

export type SmsReceptionist = ReturnType<typeof createSmsReceptionist>;
