/**
 * AI Receptionist engine — transport-neutral call orchestration.
 *
 * Flow: answer → (language menu) → greeting → listen → [emergency guardrail]
 *       → brain decides (ask / transfer / end) → … → call ends → summary →
 *       notifications (+ Module A SMS recovery when the caller hung up early).
 *
 * Every public method returns a `VoicePlan`; webhooks render it to TwiML and a
 * self-hosted voice server can execute it directly (see voice.ts).
 */

import { randomUUID } from "@/lib/id";
import { logReceptionistDiagnostic } from "./diagnostics";
import { isAfterHours } from "@/product/missed-call/call-handling";
import { shouldAnswerCall } from "./call-handling";
import { decideInboundRouting } from "@/product/telephony/call-routing";
import { defaultPhoneSettings } from "@/product/telephony/phone-settings";
import { classifyUrgency } from "@/product/missed-call/urgency";
import type { Clock, UrgencyClassification } from "@/product/missed-call/types";
import {
  nextMissingStep,
  questionForStep,
  wrapUpOutcome,
  wrapUpReply,
} from "./brain-rules";
import {
  localDayWindow,
  matchOffered,
  parseTimePreference,
  pickOffers,
  readOptions,
  spokenSlotLabel,
  toOfferedSlots,
  type OpeningsResult,
  type ReceptionistScheduler,
  type ReserveResult,
} from "./booking";
import {
  detectLanguageSwitch,
  firstLanguage,
  isGreetingOnly,
  languageForDigits,
  languageSelectTimeoutSeconds,
  looksEnglish,
} from "./language-select";
import type { LlmClient } from "./llm";
import type { ReceptionistNotifier } from "./notifications";
import {
  afterHoursFor,
  greetingStatement,
  hintsFor,
  languageMenuPrompts,
  openingQuestion,
  phrase,
} from "./prompts";
import { isConflictError, type ReceptionistStore } from "./store";
import { buildCallSummary, generateAiSummary } from "./summary";
import type {
  AgentDecision,
  CallBooking,
  CallContext,
  CallFlags,
  CallSession,
  CallSlots,
  CallStep,
  CallTurn,
  ReceptionistBrain,
  ReceptionistConfig,
  ReceptionistLanguage,
  TransferAttempt,
  VoicePlan,
  VoiceVerb,
} from "./types";
import { gatherTuning } from "./voice";

export type ReceptionistEngineDeps = {
  store: ReceptionistStore;
  /** Current receptionist profiles (env-loaded registry). */
  configs: () => ReceptionistConfig[];
  brain: ReceptionistBrain;
  notifier: ReceptionistNotifier;
  llm?: LlmClient | null;
  clock?: Clock;
  /** Hand an incomplete call to Module A SMS recovery. */
  onIncompleteCall?: (input: {
    clientAccountId: string;
    callerE164: string;
    callSid: string;
    at: Date;
  }) => Promise<void>;
  /**
   * Look up what is already known about the caller (website lead, earlier
   * calls). Runs at finalization only — never on the live call path.
   */
  lookupContext?: (input: {
    clientAccountId: string;
    callerE164: string;
    callbackE164?: string;
    excludeSessionId: string;
  }) => Promise<CallContext | null>;
  /** Side effects after a call is finalized (timeline, CRM…). */
  onFinalized?: (
    session: CallSession,
    config: ReceptionistConfig,
  ) => Promise<void>;
  /** Scheduling is used only after the owner's phone-booking opt-in. */
  scheduler?: ReceptionistScheduler;
  /** Report an outage without delaying the live call. Delivery owns its lifetime. */
  onFailure?: (failure: ReceptionistFailure) => void;
};

export type ReceptionistFailure = {
  clientAccountId?: string;
  operation: string;
  errorCode: string;
};

/** Twilio allows ~15 s per webhook; a slow calendar must not eat all of it. */
const SCHEDULER_TIMEOUT_MS = 7000;
/** Lists of times read out per call before falling back to a request. */
const MAX_OFFER_ROUNDS = 2;
/** Answers that matched no offered time before falling back to a request. */
const MAX_OFFER_MISSES = 2;
/** Quiet turns in a row before the call ends politely ("still there?" comes first). */
const MAX_SILENT_TURNS = 2;
/** Times in a row the recognizer may be asked to repeat before the engine goes on with what it has. */
const MAX_UNCLEAR_TURNS = 2;

/**
 * Below this recognizer confidence a free-form answer is asked again rather than
 * trusted. 0 turns the check off. Twilio reports 0–1 for speech; clear speech is
 * usually above 0.8.
 */
export function minAsrConfidence(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RECEPTIONIST_MIN_ASR_CONFIDENCE;
  if (raw === undefined || raw.trim() === "") return 0.5;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 0.9 ? value : 0.5;
}

/** Steps whose answer is a free-form sentence the recognizer can get wrong. */
const CLARIFY_STEPS = new Set<CallStep>([
  "reason",
  "scope",
  "name",
  "address",
  "callback_number",
  "preferred_time",
  "correction",
]);

const TERMINAL_CALL_STATUSES = new Set([
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
  "cancelled",
]);

/** Steps where free-form speech is screened for emergencies. */
const EMERGENCY_SCREEN_STEPS = new Set([
  "language",
  "reason",
  "scope",
  "correction",
  "offer_slot",
  "anything_else",
]);

const URGENCY_RANK = { routine: 0, priority: 1, critical: 2 } as const;

/** Schedules work after the response (Next `after`, Workers `waitUntil`). */
export type DeferFn = (task: () => Promise<void>) => void;

export type ReceptionistEngine = ReturnType<typeof createReceptionistEngine>;

export function createReceptionistEngine(deps: ReceptionistEngineDeps) {
  const clock = deps.clock ?? { now: () => new Date() };
  const nowIso = () => clock.now().toISOString();

  function resolveConfig(toE164: string): ReceptionistConfig | null {
    const enabled = deps.configs().filter((c) => c.enabled);
    const digits = (s: string) =>
      s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    const byNumber = enabled.find(
      (c) => digits(c.phoneNumberE164) === digits(toE164),
    );
    if (byNumber) return byNumber;
    // Forwarded numbers arrive with a different To; a single founder-managed
    // profile still answers. Never fall back to a tenant profile: an unknown
    // number must not be answered as some other business.
    return enabled.length === 1 && enabled[0]!.source !== "profile"
      ? enabled[0]!
      : null;
  }

  function configFor(session: CallSession): ReceptionistConfig | null {
    return deps.configs().find((c) => c.id === session.configId) ?? null;
  }

  function voiceOf(config: ReceptionistConfig, lang: ReceptionistLanguage) {
    return config.voices[lang];
  }

  function listen(
    config: ReceptionistConfig,
    session: CallSession,
    prompts: { text: string; lang?: ReceptionistLanguage }[],
    opts: { dtmfDigits?: number } = {},
  ): VoiceVerb {
    const inLanguageMenu = session.step === "language";
    // After "For English, press 1" was repeated, a lone key is still listened for.
    const englishHint = Boolean(session.flags?.englishHinted);
    const allowDtmf =
      Boolean(opts.dtmfDigits) ||
      englishHint ||
      session.step === "callback_number" ||
      session.step === "callback" ||
      session.step === "offer_slot" ||
      inLanguageMenu;
    return {
      verb: "gather",
      next: "gather",
      language: session.language,
      prompts: prompts
        .filter((p) => p.text.trim())
        .map((p) => ({
          text: p.text,
          voice: voiceOf(config, p.lang ?? session.language),
          language: p.lang ?? session.language,
          speed: config.speakingSpeed,
        })),
      input: allowDtmf ? ["speech", "dtmf"] : ["speech"],
      // The language menu waits only briefly: no key means "stay in French".
      timeoutSeconds: inLanguageMenu
        ? languageSelectTimeoutSeconds()
        : gatherTuning().timeoutSeconds,
      numDigits:
        opts.dtmfDigits ??
        (session.step === "callback_number"
          ? 10
          : inLanguageMenu || session.step === "offer_slot"
            ? 1
            : undefined),
      hints: hintsFor(config),
    };
  }

  function say(
    config: ReceptionistConfig,
    lang: ReceptionistLanguage,
    text: string,
  ): VoiceVerb {
    return {
      verb: "say",
      text,
      language: lang,
      voice: voiceOf(config, lang),
      speed: config.speakingSpeed,
    };
  }

  /**
   * What starts a call: the greeting, then (bilingual line) the language menu in
   * French first, or (one language) the after-hours notice and the opening question.
   */
  function openingFor(
    config: ReceptionistConfig,
    afterHours: boolean,
  ): {
    language: ReceptionistLanguage;
    step: CallStep;
    prompts: { text: string; lang?: ReceptionistLanguage }[];
  } {
    const language = firstLanguage(config.languages, config.defaultLanguage);
    if (config.languages.length > 1) {
      return {
        language,
        step: "language",
        prompts: [
          { text: greetingStatement(config, language), lang: language },
          ...languageMenuPrompts(),
        ],
      };
    }
    return {
      language,
      step: "reason",
      prompts: [
        { text: greetingStatement(config, language) },
        ...(afterHours ? [{ text: afterHoursFor(config, language) }] : []),
        { text: openingQuestion(config, language) },
      ],
    };
  }

  /** The words that go with the notice owed to an after-hours caller, once. */
  function afterHoursNotice(
    config: ReceptionistConfig,
    session: CallSession,
  ): string {
    return session.afterHours ? afterHoursFor(config, session.language) : "";
  }

  function mergeFlags(
    session: CallSession,
    flags: Partial<CallFlags> | undefined,
  ): CallFlags | undefined {
    return flags ? { ...session.flags, ...flags } : session.flags;
  }

  /** Ask a question (one or two short prompts) and record what was said. */
  function askPlan(
    config: ReceptionistConfig,
    session: CallSession,
    prompts: { text: string; lang?: ReceptionistLanguage }[],
  ): { session: CallSession; plan: VoicePlan } {
    const spoken = prompts.filter((p) => p.text.trim());
    const next: CallSession = {
      ...session,
      turns: [
        ...session.turns,
        ...spoken.map((p) =>
          turn("agent", p.text, { action: "ask", brain: "rules" }),
        ),
      ],
    };
    return {
      session: next,
      plan: { sessionId: next.id, verbs: [listen(config, next, spoken)] },
    };
  }

  /**
   * The language menu is over: the call goes on in `language` and the caller is
   * asked what they need. The greeting is not repeated. `chosen` is true when the
   * caller pressed a key or asked for the language, so it is acknowledged.
   */
  function continueInLanguage(
    config: ReceptionistConfig,
    session: CallSession,
    language: ReceptionistLanguage,
    opts: { chosen: boolean },
  ): { session: CallSession; plan: VoicePlan } {
    const next: CallSession = {
      ...session,
      language,
      step: "reason",
      silenceCount: 0,
      unclearCount: 0,
      flags: { ...session.flags, languageLocked: true },
    };
    const prompts: { text: string }[] = [];
    if (opts.chosen) {
      prompts.push({
        text: phrase(
          language === "en" ? "languageChosenEn" : "languageChosenFr",
          language,
        ),
      });
    }
    const notice = afterHoursNotice(config, next);
    if (notice) prompts.push({ text: notice });
    prompts.push({ text: openingQuestion(config, language) });
    return askPlan(config, next, prompts);
  }

  /**
   * The recognizer was unsure of a French turn. Ask again, and remind an
   * English speaker that a key is waiting for them.
   */
  function askAgainWithEnglishHint(
    config: ReceptionistConfig,
    session: CallSession,
  ): { session: CallSession; plan: VoicePlan } {
    const next: CallSession = {
      ...session,
      unclearCount: (session.unclearCount ?? 0) + 1,
      flags: { ...session.flags, englishHinted: true },
    };
    return askPlan(config, next, [
      { text: phrase("unclear", "fr"), lang: "fr" },
      { text: phrase("pressForEnglish", "en"), lang: "en" },
    ]);
  }

  /** Add "For English, press 1." (in the English voice) after the question being asked. */
  function appendEnglishHint(config: ReceptionistConfig, plan: VoicePlan): void {
    const gather = plan.verbs.findLast((v) => v.verb === "gather");
    if (gather?.verb !== "gather") return;
    gather.prompts.push({
      text: phrase("pressForEnglish", "en"),
      voice: voiceOf(config, "en"),
      language: "en",
      speed: config.speakingSpeed,
    });
  }

  /** The caller asked, out loud, to continue in another language. */
  function switchLanguageMidCall(
    config: ReceptionistConfig,
    session: CallSession,
    language: ReceptionistLanguage,
  ): { session: CallSession; plan: VoicePlan } {
    let booking = session.booking;
    let question: string;
    if (session.step === "offer_slot" && booking) {
      // The times are re-worded in the new language; the times themselves do not change.
      booking = {
        ...booking,
        offered: booking.offered.map((slot) => ({
          ...slot,
          label: spokenSlotLabel(slot.startAt, booking!.timezone, language),
        })),
      };
      question = phrase("offerSlots", language, {
        options: readOptions(booking.offered),
      });
    } else {
      const step: CallStep =
        session.step === "language" || session.step === "done"
          ? "reason"
          : session.step;
      question = questionForStep(step, language, session, session.slots);
    }
    const next: CallSession = {
      ...session,
      language,
      booking,
      silenceCount: 0,
      unclearCount: 0,
      flags: { ...session.flags, languageLocked: true },
    };
    return askPlan(config, next, [
      {
        text: phrase(
          language === "en" ? "languageSwitchedEn" : "languageSwitchedFr",
          language,
        ),
      },
      { text: question },
    ]);
  }

  function turn(
    speaker: CallTurn["speaker"],
    text: string,
    extra: Partial<CallTurn> = {},
  ): CallTurn {
    return { at: nowIso(), speaker, text, ...extra };
  }

  async function save(session: CallSession): Promise<CallSession> {
    return deps.store.saveSession({ ...session, updatedAt: nowIso() });
  }

  /**
   * Re-run a mutation once on an optimistic-lock conflict.
   *
   * `expectedCallSid`, when given, must match the session's own CallSid.
   * sessionId alone is an unguessable UUID, but this closes the gap where a
   * stale/replayed Twilio callback (or a bug on Twilio's side re-sending an
   * action URL for an ended leg) could otherwise touch a session that has
   * since moved on to a different call.
   */
  async function withSession<T>(
    sessionId: string,
    fn: (
      session: CallSession,
    ) => Promise<{ session: CallSession | null; result: T }>,
    expectedCallSid?: string,
  ): Promise<T | null> {
    const attempts = 4;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const session = await deps.store.getSession(sessionId);
      if (!session) return null;
      if (expectedCallSid && session.callSid !== expectedCallSid) {
        logReceptionistDiagnostic({
          event: "webhook_failed",
          code: "SESSION_CALL_SID_MISMATCH",
          callSid: expectedCallSid,
        });
        return null;
      }
      const { session: next, result } = await fn(session);
      if (!next) return result;
      try {
        await save(next);
        return result;
      } catch (err) {
        if (!isConflictError(err) || attempt === attempts - 1) throw err;
      }
    }
    return null;
  }

  function hangupPlan(sessionId: string | null): VoicePlan {
    return { sessionId, verbs: [{ verb: "hangup" }] };
  }

  /**
   * Safe plan when anything throws: apologize, then a human (fallback line)
   * or voicemail. Never dead air.
   *
   * `cause: "declined"` is for calls we chose not to answer (unknown number,
   * outside the configured handling mode): same apology, but nothing broke, so
   * nothing is reported. Anything else is a receptionist failure and is
   * reported for monitoring and owner alerts.
   */
  function failSafePlan(
    config: ReceptionistConfig | null,
    sessionId: string | null,
    lang: ReceptionistLanguage = config?.defaultLanguage ?? "fr",
    opts: {
      cause?: "error" | "declined";
      clientAccountId?: string;
      operation?: string;
    } = {},
  ): VoicePlan {
    const voice =
      config?.voices[lang] ??
      (lang === "fr" ? "Polly.Gabrielle-Neural" : "Polly.Joanna-Neural");
    const verbs: VoiceVerb[] = [
      {
        verb: "say",
        text: phrase("technicalIssue", lang),
        language: lang,
        voice,
      },
    ];
    if (opts.cause !== "declined") {
      try {
        deps.onFailure?.({
          clientAccountId: opts.clientAccountId ?? config?.clientAccountId,
          operation: opts.operation ?? "continue_call",
          errorCode: "AI_SESSION_FAILED",
        });
      } catch (err) {
        console.warn("[receptionist] failure report skipped", err);
      }
    }
    if (config?.fallbackTransferE164) {
      verbs.push({
        verb: "dial",
        next: "dial",
        phoneE164: config.fallbackTransferE164,
        timeoutSeconds: 25,
      });
    } else {
      verbs.push(
        {
          verb: "say",
          text: phrase("voicemailIntro", lang),
          language: lang,
          voice,
        },
        { verb: "record", next: "voicemail", maxLengthSeconds: 120 },
      );
    }
    return { sessionId, verbs };
  }

  function mergeUrgency(
    current: UrgencyClassification | undefined,
    next: UrgencyClassification,
  ): UrgencyClassification {
    if (!current) return next;
    return URGENCY_RANK[next.level] > URGENCY_RANK[current.level]
      ? next
      : current;
  }

  function emergencyTransferAllowed(
    config: ReceptionistConfig,
    session: CallSession,
  ) {
    if (!config.emergencyTransferE164) return false;
    return (
      !session.afterHours ||
      config.afterHoursMode === "take_message_emergency_transfer"
    );
  }

  function startTransfer(
    session: CallSession,
    attempt: Omit<TransferAttempt, "at" | "status">,
  ): CallSession {
    return {
      ...session,
      status: "transferring",
      transfers: [
        ...session.transfers,
        { ...attempt, at: nowIso(), status: "dialing" },
      ],
    };
  }

  /** Turn a brain decision into session state + verbs. */
  function applyDecision(
    config: ReceptionistConfig,
    session: CallSession,
    decision: AgentDecision,
  ): { session: CallSession; plan: VoicePlan } {
    let next: CallSession = {
      ...session,
      slots: decision.slots
        ? { ...session.slots, ...decision.slots }
        : session.slots,
      intent: decision.intent ?? session.intent,
      outcome: decision.outcome ?? session.outcome,
      step: decision.nextStep,
      flags: mergeFlags(session, decision.flags),
      unclearCount: 0,
      turns: [
        ...session.turns,
        turn("agent", decision.reply, {
          action: decision.action.type,
          brain: decision.brain,
        }),
      ],
    };
    const lang = next.language;

    if (decision.action.type === "transfer") {
      const targetId = decision.action.targetId;
      const target =
        targetId === "fallback"
          ? config.fallbackTransferE164
            ? {
                id: "fallback",
                name: lang === "fr" ? "un membre de l'équipe" : "a team member",
                phoneE164: config.fallbackTransferE164,
              }
            : null
          : (config.routing.find((r) => r.id === targetId) ?? null);
      if (target) {
        next = startTransfer(next, {
          targetId: target.id,
          targetName: target.name,
          phoneE164: target.phoneE164,
          reason: targetId === "fallback" ? "fallback" : "caller_request",
        });
        return {
          session: next,
          plan: {
            sessionId: next.id,
            verbs: [
              say(config, lang, decision.reply),
              {
                verb: "dial",
                next: "dial",
                phoneE164: target.phoneE164,
                timeoutSeconds: 25,
              },
            ],
          },
        };
      }
      // Unknown target: keep collecting instead of dropping the caller.
      const step = nextMissingStep(config, next, next.slots);
      const question = questionForStep(step, lang, next, next.slots);
      next = { ...next, step };
      return {
        session: next,
        plan: {
          sessionId: next.id,
          verbs: [listen(config, next, [{ text: question }])],
        },
      };
    }

    if (decision.action.type === "end_call") {
      next = {
        ...next,
        step: "done",
        outcome: next.outcome ?? wrapUpOutcome(next, next.slots),
      };
      return {
        session: next,
        plan: {
          sessionId: next.id,
          verbs: [say(config, lang, decision.reply), { verb: "hangup" }],
        },
      };
    }

    return {
      session: next,
      plan: {
        sessionId: next.id,
        verbs: [listen(config, next, [{ text: decision.reply }])],
      },
    };
  }

  async function runEmergencyPath(
    config: ReceptionistConfig,
    session: CallSession,
    utterance: string,
    defer?: DeferFn,
  ): Promise<{ session: CallSession; plan: VoicePlan }> {
    const lang = session.language;
    let next: CallSession = {
      ...session,
      intent: "emergency",
      slots: { ...session.slots, issue: session.slots.issue ?? utterance },
    };

    const sendAlerts = () =>
      deps.notifier.alertEmergency(config, next, utterance);
    if (defer) {
      // Do not hold the TwiML response (Twilio 15 s budget) on SMS latency.
      const sessionId = next.id;
      defer(async () => {
        try {
          const alerts = await sendAlerts();
          await withSession(sessionId, async (s) => ({
            session: { ...s, notifications: [...s.notifications, ...alerts] },
            result: null,
          }));
        } catch (err) {
          console.error("[receptionist] emergency alert failed", err);
        }
      });
    } else {
      try {
        const alerts = await sendAlerts();
        next = { ...next, notifications: [...next.notifications, ...alerts] };
      } catch (err) {
        console.error("[receptionist] emergency alert failed", err);
      }
    }

    if (emergencyTransferAllowed(config, next)) {
      const reply = phrase("emergencyTransfer", lang);
      next = startTransfer(
        {
          ...next,
          step: "done",
          turns: [
            ...next.turns,
            turn("agent", reply, { action: "transfer", brain: "guardrail" }),
          ],
        },
        {
          targetId: "emergency",
          targetName: lang === "fr" ? "l'équipe de garde" : "the on-call team",
          phoneE164: config.emergencyTransferE164!,
          reason: "emergency",
        },
      );
      return {
        session: next,
        plan: {
          sessionId: next.id,
          verbs: [
            say(config, lang, reply),
            {
              verb: "dial",
              next: "dial",
              phoneE164: config.emergencyTransferE164!,
              timeoutSeconds: 30,
            },
          ],
        },
      };
    }

    const step = nextMissingStep(config, next, next.slots);
    const reply = `${phrase("emergencyNoTransfer", lang)} ${questionForStep(step, lang, next, next.slots)}`;
    next = {
      ...next,
      step,
      turns: [
        ...next.turns,
        turn("agent", reply, { action: "ask", brain: "guardrail" }),
      ],
    };
    return {
      session: next,
      plan: {
        sessionId: next.id,
        verbs: [listen(config, next, [{ text: reply }])],
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Phone booking                                                           */
  /*                                                                         */
  /* Deterministic on purpose: every time read out comes from the scheduling */
  /* backend, and "booked" is spoken only after it returns `confirmed`. The  */
  /* brain (rules or LLM) never reaches this stage.                          */
  /* ---------------------------------------------------------------------- */

  function reportBookingFailure(errorCode: string) {
    void import("@/product/reliability/hooks")
      .then(({ recordFailure }) =>
        recordFailure({
          service: "ai_receptionist",
          operation: "book_appointment",
          errorCode,
          severity: "medium",
          retryable: true,
        }),
      )
      .catch(() => undefined);
  }

  /** A scheduling call that answers inside the webhook budget, or null. */
  async function withinBudget<T>(task: () => Promise<T>): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SCHEDULER_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      console.error("[receptionist] scheduling call failed", err);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Owner opted in, the caller wants an appointment and the details are in. */
  function bookingReady(
    config: ReceptionistConfig,
    session: CallSession,
    slots: CallSlots,
    intent: CallSession["intent"],
  ): boolean {
    return (
      Boolean(deps.scheduler) &&
      config.phoneBooking === true &&
      intent === "appointment" &&
      !session.booking &&
      Boolean(slots.callerName && slots.serviceAddress && slots.callbackE164)
    );
  }

  /** Back to what a call did before booking existed: a request the team confirms. */
  function fallBackToRequest(
    config: ReceptionistConfig,
    session: CallSession,
    reason: string,
    chosenLabel?: string,
  ): { session: CallSession; plan: VoicePlan } {
    const lang = session.language;
    const reply = phrase("bookingRequestOnly", lang, {
      name: session.slots.callerName,
    });
    const next: CallSession = {
      ...session,
      step: "done",
      outcome: "appointment_requested",
      booking: {
        timezone: config.timezone,
        rounds: 0,
        misses: 0,
        ...session.booking,
        status: "requested",
        offered: [],
        fallbackReason: reason,
      },
      slots: chosenLabel
        ? { ...session.slots, preferredTime: chosenLabel }
        : session.slots,
      turns: [
        ...session.turns,
        turn("agent", reply, { action: "end_call", brain: "guardrail" }),
      ],
    };
    return {
      session: next,
      plan: {
        sessionId: next.id,
        verbs: [say(config, lang, reply), { verb: "hangup" }],
      },
    };
  }

  function presentOffers(
    config: ReceptionistConfig,
    session: CallSession,
    booking: CallBooking,
    kind:
      "offerSlots" | "offerNearest" | "offerMore" | "slotTaken" | "offerRepeat",
    wish?: string,
  ): { session: CallSession; plan: VoicePlan } {
    const reply = phrase(kind, session.language, {
      options: readOptions(booking.offered),
    });
    const next: CallSession = {
      ...session,
      step: "offer_slot",
      booking,
      slots: wish
        ? { ...session.slots, preferredTime: wish.trim().slice(0, 200) }
        : session.slots,
      turns: [
        ...session.turns,
        turn("agent", reply, { action: "ask", brain: "rules" }),
      ],
    };
    return {
      session: next,
      plan: {
        sessionId: next.id,
        verbs: [listen(config, next, [{ text: reply }])],
      },
    };
  }

  async function openingsFor(
    config: ReceptionistConfig,
    session: CallSession,
    input: { serviceId?: string; from: Date; until?: Date },
  ): Promise<OpeningsResult> {
    const result = await withinBudget(() =>
      deps.scheduler!.listOpenings({
        config,
        issue: session.slots.issue,
        serviceId: input.serviceId,
        serviceAddress: session.slots.serviceAddress,
        language: session.language,
        from: input.from,
        until: input.until,
      }),
    );
    if (!result) reportBookingFailure("OPENINGS_UNAVAILABLE");
    return result ?? { ok: false, reason: "unavailable" };
  }

  /** Read out up to three real openings, ranked by what the caller asked for. */
  async function beginBooking(
    config: ReceptionistConfig,
    session: CallSession,
    wish?: string,
  ): Promise<{ session: CallSession; plan: VoicePlan }> {
    const now = clock.now();
    const pref = wish ? parseTimePreference(wish, now, config.timezone) : {};
    const day = pref.dateKey
      ? localDayWindow(pref.dateKey, config.timezone)
      : null;

    const first = await openingsFor(config, session, {
      from: day && day.from > now ? day.from : now,
      until: day?.until,
    });
    if (!first.ok) return fallBackToRequest(config, session, first.reason);

    let opened = first;
    let { picks, exact } = pickOffers(first.slots, pref, first.timezone);
    if (picks.length === 0 && day) {
      // Nothing on the day they asked for: read the next openings instead.
      const wider = await openingsFor(config, session, {
        serviceId: first.service.id,
        from: now,
      });
      if (!wider.ok) return fallBackToRequest(config, session, wider.reason);
      opened = wider;
      picks = pickOffers(wider.slots, {}, wider.timezone).picks;
      exact = false;
    }
    if (picks.length === 0) {
      return fallBackToRequest(config, session, "no_openings");
    }

    return presentOffers(
      config,
      session,
      {
        status: "offering",
        serviceId: opened.service.id,
        serviceName: opened.service.name,
        timezone: opened.timezone,
        offered: toOfferedSlots(picks, opened.timezone, session.language),
        rounds: 1,
        misses: 0,
      },
      exact ? "offerSlots" : "offerNearest",
      wish,
    );
  }

  function settleReservation(
    config: ReceptionistConfig,
    session: CallSession,
    booking: CallBooking,
    chosenLabel: string,
    reserved: ReserveResult | null,
  ): { session: CallSession; plan: VoicePlan } {
    const lang = session.language;

    if (reserved?.status === "confirmed") {
      const label = spokenSlotLabel(reserved.startAt, booking.timezone, lang);
      const reply = phrase("bookedConfirmed", lang, {
        name: session.slots.callerName,
        when: label,
      });
      const next: CallSession = {
        ...session,
        step: "done",
        outcome: "appointment_booked",
        booking: {
          ...booking,
          status: "booked",
          offered: [],
          appointmentId: reserved.appointmentId,
          startAt: reserved.startAt,
          label,
        },
        turns: [
          ...session.turns,
          turn("agent", reply, { action: "end_call", brain: "rules" }),
        ],
      };
      return {
        session: next,
        plan: {
          sessionId: next.id,
          verbs: [say(config, lang, reply), { verb: "hangup" }],
        },
      };
    }

    if (reserved?.status === "conflict" && booking.rounds <= MAX_OFFER_ROUNDS) {
      // Someone else took it while we were talking: offer what is still free.
      const { picks } = pickOffers(reserved.alternatives, {}, booking.timezone);
      if (picks.length > 0) {
        return presentOffers(
          config,
          session,
          {
            ...booking,
            offered: toOfferedSlots(picks, booking.timezone, lang),
            rounds: booking.rounds + 1,
            misses: 0,
          },
          "slotTaken",
        );
      }
    }

    const reason =
      reserved === null
        ? "reserve_timeout"
        : reserved.status === "request"
          ? reserved.reason
          : reserved.status === "conflict"
            ? "slot_taken"
            : "reserve_error";
    if (reserved === null || reserved.status === "error") {
      reportBookingFailure("RESERVE_FAILED");
    }
    return fallBackToRequest(config, session, reason, chosenLabel);
  }

  /** The caller's answer to a list of openings. */
  async function answerOffer(
    config: ReceptionistConfig,
    session: CallSession,
    utterance: string,
    digits?: string,
  ): Promise<{ session: CallSession; plan: VoicePlan }> {
    const booking = session.booking;
    if (!booking || booking.status !== "offering" || !deps.scheduler) {
      return fallBackToRequest(config, session, "booking_unavailable");
    }
    const answer = matchOffered(
      utterance,
      digits,
      booking.offered,
      booking.timezone,
    );

    if (answer.kind === "pick") {
      const chosen = booking.offered[answer.index]!;
      const reserved = await withinBudget(() =>
        deps.scheduler!.reserve({
          config,
          serviceId: booking.serviceId,
          serviceName: booking.serviceName,
          startAt: chosen.startAt,
          callerName: session.slots.callerName,
          callbackE164: session.slots.callbackE164,
          serviceAddress: session.slots.serviceAddress,
          language: session.language,
          // A repeated webhook must never book the same time twice.
          idempotencyKey: `rcs:${session.id}:${chosen.startAt}`,
        }),
      );
      return settleReservation(
        config,
        session,
        booking,
        chosen.label,
        reserved,
      );
    }

    if (answer.kind === "decline") {
      if (booking.rounds >= MAX_OFFER_ROUNDS) {
        return fallBackToRequest(config, session, "declined_openings");
      }
      const last = booking.offered.at(-1)!;
      const more = await openingsFor(config, session, {
        serviceId: booking.serviceId,
        from: new Date(Date.parse(last.startAt) + 30 * 60_000),
      });
      if (!more.ok) return fallBackToRequest(config, session, more.reason);
      const { picks } = pickOffers(more.slots, {}, more.timezone);
      if (picks.length === 0) {
        return fallBackToRequest(config, session, "no_more_openings");
      }
      return presentOffers(
        config,
        session,
        {
          ...booking,
          timezone: more.timezone,
          offered: toOfferedSlots(picks, more.timezone, session.language),
          rounds: booking.rounds + 1,
          misses: 0,
        },
        "offerMore",
      );
    }

    const misses = booking.misses + 1;
    if (misses >= MAX_OFFER_MISSES) {
      return fallBackToRequest(config, session, "unclear_answer");
    }
    return presentOffers(
      config,
      session,
      { ...booking, misses },
      "offerRepeat",
    );
  }

  async function finalizeSession(
    sessionId: string,
  ): Promise<CallSession | null> {
    // 1) Claim finalization so concurrent callbacks never double-notify.
    let claimed: CallSession | null = null;
    for (let attempt = 0; attempt < 3 && !claimed; attempt += 1) {
      const current = await deps.store.getSession(sessionId);
      if (!current || current.finalizedAt) return current;
      try {
        claimed = await save({
          ...current,
          status: current.status === "failed" ? "failed" : "completed",
          outcome: current.outcome ?? "caller_hung_up",
          endedAt: current.endedAt ?? nowIso(),
          finalizedAt: nowIso(),
        });
      } catch (err) {
        if (!isConflictError(err)) throw err;
      }
    }
    if (!claimed) return null;

    const config = configFor(claimed);
    if (!config) {
      console.error(
        "[receptionist] finalize: config missing",
        claimed.configId,
      );
      return claimed;
    }

    let session = claimed;
    const incomplete =
      session.outcome === "caller_hung_up" &&
      !session.slots.issue &&
      !session.slots.message;
    if (incomplete && config.smsRecoveryOnIncomplete && deps.onIncompleteCall) {
      try {
        await deps.onIncompleteCall({
          clientAccountId: config.clientAccountId,
          callerE164: session.fromE164,
          callSid: session.callSid,
          at: new Date(session.startedAt),
        });
        session = { ...session, smsRecoveryTriggeredAt: nowIso() };
      } catch (err) {
        console.error("[receptionist] SMS recovery hand-off failed", err);
      }
    }

    if (deps.lookupContext) {
      try {
        const context = await Promise.race([
          deps.lookupContext({
            clientAccountId: config.clientAccountId,
            callerE164: session.fromE164,
            callbackE164: session.slots.callbackE164,
            excludeSessionId: session.id,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (context) session = { ...session, context };
      } catch (err) {
        console.warn("[receptionist] context lookup failed", err);
      }
    }

    const summary = buildCallSummary(config, session);
    summary.aiSummary = await generateAiSummary(
      deps.llm ?? null,
      config,
      session,
    );
    session = { ...session, summary };

    try {
      const deliveries = await deps.notifier.deliverSummary(
        config,
        session,
        summary,
      );
      session = {
        ...session,
        notifications: [...session.notifications, ...deliveries],
      };
    } catch (err) {
      console.error("[receptionist] summary delivery failed", err);
    }

    // 2) Persist results (retry against late status/recording updates).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        session = await save(session);
        break;
      } catch (err) {
        if (!isConflictError(err) || attempt === 2) throw err;
        const latest = await deps.store.getSession(sessionId);
        if (!latest) break;
        session = {
          ...latest,
          summary: session.summary,
          context: session.context,
          notifications: session.notifications,
          smsRecoveryTriggeredAt: session.smsRecoveryTriggeredAt,
        };
      }
    }

    if (deps.onFinalized) {
      try {
        await deps.onFinalized(session, config);
      } catch (err) {
        console.warn("[receptionist] onFinalized hook failed", err);
      }
    }
    return session;
  }

  return {
    resolveConfig,
    failSafePlan,
    /** The scheduling backend, for callers (the voice-agent API) that book outside a Twilio call. */
    scheduler: deps.scheduler,

    /** Inbound call webhook: create the session and greet (or ring human first). */
    async startCall(input: {
      callSid: string;
      fromE164: string;
      toE164: string;
      /** Skip human-first / overflow ring and go straight to the AI. */
      skipHumanRing?: boolean;
    }): Promise<VoicePlan> {
      const config = resolveConfig(input.toE164);
      if (!config) {
        const configs = deps.configs();
        logReceptionistDiagnostic({
          event: "incoming_declined",
          code: "NO_ENABLED_CONFIG_FOR_NUMBER",
          callSid: input.callSid,
          dialedNumber: input.toE164,
          profiles: configs.length,
          enabledProfiles: configs.filter((c) => c.enabled).length,
        });
        return failSafePlan(null, null, undefined, { cause: "declined" });
      }

      const at = clock.now();
      if (!shouldAnswerCall(config, at)) {
        logReceptionistDiagnostic({
          event: "incoming_declined",
          code: "CALL_HANDLING_MODE_DECLINED",
          callSid: input.callSid,
          dialedNumber: input.toE164,
        });
        return failSafePlan(null, null, undefined, { cause: "declined" });
      }

      const phone = {
        ...defaultPhoneSettings(),
        aiEnabled: config.enabled,
        inboundStrategy: config.inboundStrategy ?? "ai_first",
        humanRingTimeoutSeconds: config.humanRingTimeoutSeconds ?? 25,
        humanTransferE164: config.fallbackTransferE164,
        ringHumanOnOverflow: true,
      };
      const routing = input.skipHumanRing
        ? ({ action: "ai", reason: "forced_ai", strategy: "ai_first" } as const)
        : decideInboundRouting({ config, phone, now: at });

      if (routing.action === "reject") {
        logReceptionistDiagnostic({
          event: "incoming_declined",
          code: "ROUTING_REJECTED",
          callSid: input.callSid,
          dialedNumber: input.toE164,
        });
        return failSafePlan(config, null, undefined, { cause: "declined" });
      }

      const afterHours = isAfterHours(config, at);
      const opening = openingFor(config, afterHours);
      const draft: CallSession = {
        id: `rcs_${randomUUID()}`,
        callSid: input.callSid,
        configId: config.id,
        clientAccountId: config.clientAccountId,
        fromE164: input.fromE164,
        toE164: input.toE164,
        // Every call starts in French when French is enabled; see language-select.ts.
        language: opening.language,
        status:
          routing.action === "ring_human" ? "transferring" : "in_progress",
        step: opening.step,
        afterHours,
        slots: {},
        turns: [],
        silenceCount: 0,
        callerTurnCount: 0,
        transfers:
          routing.action === "ring_human"
            ? [
                {
                  at: at.toISOString(),
                  targetId: "primary",
                  targetName:
                    config.defaultLanguage === "fr" ? "l'équipe" : "the team",
                  phoneE164: routing.phoneE164,
                  reason:
                    routing.reason === "overflow_ring"
                      ? "overflow_ring"
                      : "human_first",
                  status: "dialing",
                  continueWithAi: routing.then === "ai",
                },
              ]
            : [],
        notifications: [],
        startedAt: at.toISOString(),
        updatedAt: at.toISOString(),
        version: 1,
      };

      const { session, created } =
        await deps.store.insertSessionIfAbsent(draft);

      if (!created) {
        // Twilio retry of the same call: repeat the current question.
        if (session.status === "transferring") {
          const last = session.transfers.at(-1);
          if (last) {
            return {
              sessionId: session.id,
              verbs: [
                {
                  verb: "dial",
                  next: "dial",
                  phoneE164: last.phoneE164,
                  timeoutSeconds: config.humanRingTimeoutSeconds ?? 25,
                  callerIdE164: config.phoneNumberE164,
                },
              ],
            };
          }
        }
        // At the language menu a retry plays the menu again, not a question.
        const retryPrompts =
          session.step === "language"
            ? [
                {
                  text: greetingStatement(config, session.language),
                  lang: session.language,
                },
                ...languageMenuPrompts(),
              ]
            : [
                {
                  text: questionForStep(
                    session.step,
                    session.language,
                    session,
                    session.slots,
                  ),
                },
              ];
        return {
          sessionId: session.id,
          verbs: [listen(config, session, retryPrompts)],
        };
      }

      if (routing.action === "ring_human") {
        return {
          sessionId: session.id,
          verbs: [
            {
              verb: "dial",
              next: "dial",
              phoneE164: routing.phoneE164,
              timeoutSeconds: routing.timeoutSeconds,
              callerIdE164: config.phoneNumberE164,
            },
          ],
        };
      }

      const prompts = opening.prompts;
      const greeted = await save({
        ...session,
        turns: prompts.map((p) =>
          turn("agent", p.text, { action: "greet", brain: "rules" }),
        ),
      });
      return {
        sessionId: greeted.id,
        verbs: [listen(config, greeted, prompts)],
      };
    },

    /** Speech / DTMF result from a <Gather>. */
    async handleGather(input: {
      sessionId: string;
      speech: string;
      digits?: string;
      confidence?: number;
      defer?: DeferFn;
      callSid?: string;
    }): Promise<VoicePlan> {
      // withSession may re-run the mutation on a conflict; alerts must not double-send.
      let deferred = false;
      const deferOnce: DeferFn | undefined = input.defer
        ? (task) => {
            if (deferred) return;
            deferred = true;
            input.defer!(task);
          }
        : undefined;
      const plan = await withSession<VoicePlan>(
        input.sessionId,
        async (session) => {
          const config = configFor(session);
          if (!config)
            return {
              session: null,
              result: failSafePlan(null, session.id, session.language, {
                clientAccountId: session.clientAccountId,
                operation: "handle_gather",
              }),
            };
          if (session.status !== "in_progress" || session.step === "done") {
            return { session: null, result: hangupPlan(session.id) };
          }

          const speech = input.speech.trim();
          const digits = input.digits?.replace(/[^\d*#]/g, "") || undefined;
          const heard = speech || digits || "";

          // Language menu: the caller pressed nothing. Stay in French and ask
          // what they need — a quiet line here is the normal French path.
          if (!heard && session.step === "language") {
            const r = continueInLanguage(config, session, session.language, {
              chosen: false,
            });
            return { session: r.session, result: r.plan };
          }

          if (!heard) {
            const silenceCount = session.silenceCount + 1;
            if (silenceCount >= MAX_SILENT_TURNS) {
              // Nobody is answering. During a booking the details are already
              // in, so hand them to the team; otherwise end politely.
              if (session.step === "offer_slot" && session.booking) {
                const r = fallBackToRequest(
                  config,
                  { ...session, silenceCount },
                  "no_answer",
                );
                return { session: r.session, result: r.plan };
              }
              const lang = session.language;
              const reply = phrase("silenceGoodbye", lang);
              const next: CallSession = {
                ...session,
                silenceCount,
                step: "done",
                turns: [
                  ...session.turns,
                  turn("system", "silence → goodbye"),
                  turn("agent", reply, { action: "end_call", brain: "guardrail" }),
                ],
              };
              return {
                session: next,
                result: {
                  sessionId: next.id,
                  verbs: [say(config, lang, reply), { verb: "hangup" }],
                },
              };
            }
            const next: CallSession = { ...session, silenceCount };
            const lang = session.language;
            const prompts =
              session.step === "language"
                ? languageMenuPrompts()
                : session.step === "offer_slot" && session.booking
                  ? [
                      {
                        text: phrase("offerRepeat", lang, {
                          options: readOptions(session.booking.offered),
                        }),
                      },
                    ]
                  : [
                      { text: phrase("stillThere", lang) },
                      {
                        text: questionForStep(
                          session.step,
                          lang,
                          session,
                          session.slots,
                        ),
                      },
                    ];
            return {
              session: next,
              result: {
                sessionId: session.id,
                verbs: [listen(config, next, prompts)],
              },
            };
          }

          let next: CallSession = {
            ...session,
            silenceCount: 0,
            callerTurnCount: session.callerTurnCount + 1,
            turns: [
              ...session.turns,
              turn("caller", speech || `[DTMF ${digits}]`, {
                confidence: input.confidence,
              }),
            ],
          };

          // Language menu. Only the keypad chooses here; speech that is a plain
          // request for a language is honoured, any other speech is the reason.
          let reasonPrefix = "";
          // The caller talked English instead of pressing 1: keep their words as the
          // reason, stay in French, and tell them once that a key is waiting.
          let offerEnglish = false;
          if (next.step === "language") {
            const pressed = languageForDigits(digits);
            const spoken = digits ? null : detectLanguageSwitch(speech);
            const picked = pressed ?? spoken;
            const lockedLanguage =
              picked && config.languages.includes(picked) ? picked : null;
            if (lockedLanguage) {
              const r = continueInLanguage(config, next, lockedLanguage, {
                chosen: true,
              });
              return { session: r.session, result: r.plan };
            }
            const confident =
              input.confidence === undefined ||
              input.confidence >= minAsrConfidence();
            if (digits || isGreetingOnly(speech)) {
              // A stray key or just "Bonjour": carry on in French.
              const r = continueInLanguage(config, next, next.language, {
                chosen: false,
              });
              return { session: r.session, result: r.plan };
            }
            if (!confident && !next.flags?.englishHinted) {
              // Possibly an English speaker the French recognizer cannot follow.
              const r = askAgainWithEnglishHint(config, next);
              return { session: r.session, result: r.plan };
            }
            // The caller skipped the menu and started explaining: that is the reason.
            reasonPrefix = afterHoursNotice(config, next);
            offerEnglish =
              next.language === "fr" &&
              config.languages.includes("en") &&
              !next.flags?.englishHinted &&
              looksEnglish(speech);
            next = {
              ...next,
              step: "reason",
              flags: offerEnglish
                ? { ...next.flags, englishHinted: true }
                : next.flags,
            };
          }

          // Out loud, any time: "in English please" / "en français".
          if (next.step !== "language" && !digits && speech) {
            const wanted = detectLanguageSwitch(speech);
            if (wanted && config.languages.includes(wanted)) {
              const r = switchLanguageMidCall(config, next, wanted);
              return { session: r.session, result: r.plan };
            }
          }
          // The keypad hint "For English, press 1" given after an unclear French turn.
          if (
            digits === "1" &&
            next.language === "fr" &&
            next.flags?.englishHinted &&
            next.step !== "offer_slot" &&
            next.step !== "callback_number" &&
            config.languages.includes("en")
          ) {
            const r = switchLanguageMidCall(config, next, "en");
            return { session: r.session, result: r.plan };
          }

          // Emergency guardrail — deterministic, before any brain.
          if (
            EMERGENCY_SCREEN_STEPS.has(session.step) ||
            next.step === "reason"
          ) {
            const { classification } = classifyUrgency({
              issueDescription: speech,
              rubric: config.urgencyRubric,
              at: clock.now(),
            });
            if (classification.source !== "uncertain:short_description") {
              next = {
                ...next,
                urgency: mergeUrgency(next.urgency, classification),
              };
            }
            const alreadyHandled =
              next.transfers.some((t) => t.reason === "emergency") ||
              session.intent === "emergency";
            if (classification.level === "critical" && !alreadyHandled) {
              const r = await runEmergencyPath(config, next, speech, deferOnce);
              return { session: r.session, result: r.plan };
            }
          }

          // The recognizer was not sure what it heard: ask again rather than
          // guess a name, an address or a phone number. Bounded, so a noisy
          // line cannot trap the caller in a loop.
          if (
            speech &&
            !digits &&
            CLARIFY_STEPS.has(next.step) &&
            input.confidence !== undefined &&
            input.confidence < minAsrConfidence() &&
            (next.unclearCount ?? 0) < MAX_UNCLEAR_TURNS
          ) {
            if (
              next.language === "fr" &&
              config.languages.includes("en") &&
              !next.flags?.englishHinted
            ) {
              const r = askAgainWithEnglishHint(config, next);
              return { session: r.session, result: r.plan };
            }
            const r = askPlan(
              config,
              { ...next, unclearCount: (next.unclearCount ?? 0) + 1 },
              [{ text: phrase("unclear", next.language) }],
            );
            return { session: r.session, result: r.plan };
          }

          // Phone booking runs before the turn cap: it bounds itself (a few
          // rounds of openings, a few unclear answers) and must not be cut
          // off one turn before the caller picks a time.
          if (next.step === "offer_slot") {
            const r = await answerOffer(config, next, speech, digits);
            return { session: r.session, result: r.plan };
          }
          if (
            next.step === "preferred_time" &&
            bookingReady(config, next, next.slots, next.intent)
          ) {
            const r = await beginBooking(config, next, speech);
            return { session: r.session, result: r.plan };
          }

          // Turn cap: wrap up politely with what we have.
          if (next.callerTurnCount > config.maxTurns) {
            const reply = wrapUpReply(next.language, next, next.slots);
            next = {
              ...next,
              step: "done",
              outcome: next.outcome ?? wrapUpOutcome(next, next.slots),
              turns: [
                ...next.turns,
                turn("agent", reply, {
                  action: "end_call",
                  brain: "guardrail",
                }),
              ],
            };
            return {
              session: next,
              result: {
                sessionId: next.id,
                verbs: [say(config, next.language, reply), { verb: "hangup" }],
              },
            };
          }

          const decision = await deps.brain.decide({
            config,
            session: next,
            utterance: speech,
            digits,
          });

          // The brain is about to close an appointment call without a
          // reservation (e.g. the owner turned off the preferred-time
          // question): offer real openings first.
          const collected = { ...next.slots, ...decision.slots };
          const intent = decision.intent ?? next.intent;
          if (
            decision.action.type === "end_call" &&
            bookingReady(config, next, collected, intent)
          ) {
            const r = await beginBooking(
              config,
              { ...next, slots: collected, intent },
              collected.preferredTime,
            );
            return { session: r.session, result: r.plan };
          }

          // A caller who skipped the menu still hears the after-hours notice once.
          const spoken =
            reasonPrefix && decision.action.type !== "transfer"
              ? { ...decision, reply: `${reasonPrefix} ${decision.reply}` }
              : decision;
          const applied = applyDecision(config, next, spoken);
          if (offerEnglish) appendEnglishHint(config, applied.plan);
          return { session: applied.session, result: applied.plan };
        },
        input.callSid,
      );
      return plan ?? hangupPlan(null);
    },

    /** <Dial action> — result of a live transfer. */
    async handleDialResult(input: {
      sessionId: string;
      dialStatus: string;
      durationSeconds?: number;
      callSid?: string;
    }): Promise<VoicePlan> {
      const plan = await withSession<VoicePlan>(
        input.sessionId,
        async (session) => {
          const config = configFor(session);
          if (!config) return { session: null, result: hangupPlan(session.id) };
          const last = session.transfers.at(-1);
          const status = input.dialStatus.toLowerCase();
          const mapped: TransferAttempt["status"] =
            status === "completed" || status === "answered"
              ? "completed"
              : status === "busy"
                ? "busy"
                : status === "no-answer"
                  ? "no_answer"
                  : "failed";

          const transfers = last
            ? [...session.transfers.slice(0, -1), { ...last, status: mapped }]
            : session.transfers;

          if (mapped === "completed") {
            const next: CallSession = {
              ...session,
              transfers,
              status: "completed",
              step: "done",
              outcome:
                last?.reason === "emergency"
                  ? "emergency_transferred"
                  : "transferred",
              endedAt: nowIso(),
            };
            return { session: next, result: hangupPlan(session.id) };
          }

          // Overflow / human-first ring failed → hand to the AI receptionist.
          if (
            last?.continueWithAi ||
            last?.reason === "overflow_ring" ||
            last?.reason === "human_first"
          ) {
            // Nobody picked up: the AI answers, French first, like any other call.
            const opening = openingFor(config, session.afterHours);
            const prompts = opening.prompts;
            const next: CallSession = {
              ...session,
              transfers,
              status: "in_progress",
              language: opening.language,
              step: opening.step,
              turns: [
                ...session.turns,
                turn("system", `ring_${mapped}`, { action: "missed" }),
                ...prompts.map((p) =>
                  turn("agent", p.text, { action: "greet", brain: "rules" }),
                ),
              ],
            };
            return {
              session: next,
              result: {
                sessionId: next.id,
                verbs: [listen(config, next, prompts)],
              },
            };
          }

          // Nobody picked up on an explicit transfer: take the request instead.
          const lang = session.language;
          let next: CallSession = {
            ...session,
            transfers,
            status: "in_progress",
          };
          const step = nextMissingStep(config, next, next.slots);
          const reply = `${phrase("transferFailed", lang, { target: last?.targetName ?? "" })} ${questionForStep(step, lang, next, next.slots)}`;
          void import("@/product/notifications/hooks").then((mod) =>
            mod.emitTransferFailed(config.clientAccountId, session.id),
          );
          next = {
            ...next,
            step,
            intent: next.intent === "transfer" ? "message" : next.intent,
            turns: [
              ...next.turns,
              turn("agent", reply, { action: "ask", brain: "rules" }),
            ],
          };
          return {
            session: next,
            result: {
              sessionId: next.id,
              verbs: [listen(config, next, [{ text: reply }])],
            },
          };
        },
        input.callSid,
      );
      return plan ?? hangupPlan(null);
    },

    /** <Record action> — voicemail finished. */
    async handleVoicemail(input: {
      sessionId: string;
      recordingUrl?: string;
      durationSeconds?: number;
      callSid?: string;
    }): Promise<VoicePlan> {
      const plan = await withSession<VoicePlan>(
        input.sessionId,
        async (session) => {
          const config = configFor(session);
          const lang = session.language;
          const next: CallSession = {
            ...session,
            step: "done",
            recordingUrl: input.recordingUrl ?? session.recordingUrl,
            outcome: session.outcome ?? "voicemail",
            turns: [
              ...session.turns,
              turn("system", `voicemail ${input.durationSeconds ?? "?"}s`),
            ],
          };
          const verbs: VoiceVerb[] = config
            ? [
                say(config, lang, phrase("voicemailThanks", lang)),
                { verb: "hangup" },
              ]
            : [{ verb: "hangup" }];
          return { session: next, result: { sessionId: session.id, verbs } };
        },
        input.callSid,
      );
      return plan ?? hangupPlan(null);
    },

    /** Call StatusCallback — finalize on terminal statuses. */
    async handleCallStatus(input: {
      callSid: string;
      callStatus: string;
      durationSeconds?: number;
    }): Promise<{ finalized: boolean; session: CallSession | null }> {
      const status = input.callStatus.toLowerCase();
      if (!TERMINAL_CALL_STATUSES.has(status))
        return { finalized: false, session: null };
      const existing = await deps.store.getSessionByCallSid(input.callSid);
      if (!existing) return { finalized: false, session: null };

      try {
        await withSession(existing.id, async (session) => {
          if (session.finalizedAt) return { session: null, result: null };
          return {
            session: {
              ...session,
              durationSeconds: input.durationSeconds ?? session.durationSeconds,
              endedAt: session.endedAt ?? nowIso(),
              status:
                status === "failed" && !session.outcome
                  ? "failed"
                  : session.status,
              outcome:
                session.outcome ??
                (status === "failed" ? "failed" : "caller_hung_up"),
            },
            result: null,
          };
        });
      } catch (err) {
        // A concurrent duplicate callback won the race; finalizeSession below is
        // idempotent (claims finalizedAt), so this best-effort update can lose.
        if (!isConflictError(err)) throw err;
      }
      const session = await finalizeSession(existing.id);
      return { finalized: Boolean(session?.finalizedAt), session };
    },

    finalizeSession,

    /**
     * Maintenance: finalize calls whose status callback never arrived and purge
     * transcripts past each profile's retention window.
     */
    async tick(input: { staleAfterMs?: number } = {}): Promise<{
      finalized: number;
      purged: number;
    }> {
      const now = clock.now();
      const staleBefore = new Date(
        now.getTime() - (input.staleAfterMs ?? 30 * 60 * 1000),
      ).toISOString();
      let finalized = 0;
      for (const stale of await deps.store.listStaleUnfinalized(
        staleBefore,
        50,
      )) {
        const done = await finalizeSession(stale.id);
        if (done?.finalizedAt) finalized += 1;
      }
      let purged = 0;
      for (const config of deps.configs()) {
        const before = new Date(
          now.getTime() - config.transcriptRetentionDays * 86_400_000,
        ).toISOString();
        purged += await deps.store.purgeTranscripts(config.id, before);
      }
      return { finalized, purged };
    },
  };
}
