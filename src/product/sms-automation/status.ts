import type { AutomationRecord, JobRecord } from "./types";

/**
 * What an owner is told about an automation, worked out from what the system actually
 * holds: the switch, the texts waiting in the queue, the outcome of the last text, and
 * whether a text could go out at all. Pure and free of server imports, so the screen and
 * the tests use the same rules.
 *
 *  - paused     the switch is off. Nothing will be sent.
 *  - attention  the switch is on, but something stops texts or the last one failed.
 *  - scheduled  the switch is on and at least one real text is waiting to go out.
 *  - active     the switch is on and nothing is waiting or wrong.
 */
export type AutomationStatus = "paused" | "active" | "scheduled" | "attention";

export type AttentionReason =
  | "switched_off_by_tradecatch"
  | "no_number"
  | "last_failed"
  | "last_unconfirmed";

/**
 * The part of a job the status needs. No phone number, name or message text, so a screen
 * can be given this without handing a customer's details to the browser.
 */
export type JobSummary = Pick<
  JobRecord,
  "automationType" | "status" | "scheduledAt" | "updatedAt" | "simulated" | "lastError"
>;

export function summarizeJob(job: JobRecord): JobSummary {
  return {
    automationType: job.automationType,
    status: job.status,
    scheduledAt: job.scheduledAt,
    updatedAt: job.updatedAt,
    simulated: job.simulated,
    lastError: job.lastError,
  };
}

export type AutomationState = {
  status: AutomationStatus;
  reason?: AttentionReason;
  /** Real texts waiting to go out (tests from the Test Center are not counted). */
  waiting: number;
  /** When the next waiting text is due, as an ISO time. */
  nextAt?: string;
};

/** A failure older than this no longer holds the automation in "needs attention". */
export const ATTENTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Texts the three working automations can send. */
const SENDING_TYPES = new Set(["missed_call_recovery", "quote_followup", "appointment_reminder"]);

export function deriveAutomationState(input: {
  automation: Pick<AutomationRecord, "type" | "enabled">;
  /** Recent jobs of the business, any type, in any order. */
  jobs: readonly JobSummary[];
  now: Date;
  /** Whether the business has a number to text from. `null` when that could not be read. */
  senderReady: boolean | null;
  /** TradeCatch has switched missed-call texts off for everyone (an operator control). */
  recoveryTextsSwitchedOff: boolean;
}): AutomationState {
  const { automation } = input;
  const own = input.jobs.filter(
    (job) => job.automationType === automation.type && !job.simulated,
  );
  const queued = own
    .filter((job) => job.status === "pending" || job.status === "processing")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const waiting = queued.length;
  const nextAt = queued[0]?.scheduledAt;

  // A switch that is off promises nothing, whatever else is true.
  if (!automation.enabled) return { status: "paused", waiting: 0 };

  if (automation.type === "missed_call_recovery" && input.recoveryTextsSwitchedOff) {
    return { status: "attention", reason: "switched_off_by_tradecatch", waiting: 0 };
  }
  if (SENDING_TYPES.has(automation.type) && input.senderReady === false) {
    return { status: "attention", reason: "no_number", waiting };
  }

  // The most recent text that actually went out, or failed to. Skipped and canceled texts
  // are the rules doing their job (an opt-out, a reply), and a bad number belongs to one
  // customer, so neither counts as a problem with the automation.
  const outcome = own
    .filter(
      (job) =>
        (job.status === "failed" && job.lastError !== "invalid_phone") ||
        job.status === "uncertain" ||
        job.status === "submitted" ||
        job.status === "sent" ||
        job.status === "delivered",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (outcome && (outcome.status === "failed" || outcome.status === "uncertain")) {
    const age = input.now.getTime() - Date.parse(outcome.updatedAt);
    if (!Number.isFinite(age) || age <= ATTENTION_WINDOW_MS) {
      return {
        status: "attention",
        reason: outcome.status === "failed" ? "last_failed" : "last_unconfirmed",
        waiting,
        nextAt,
      };
    }
  }

  if (waiting > 0) return { status: "scheduled", waiting, nextAt };
  return { status: "active", waiting: 0 };
}

/**
 * The reasons a text was not sent or a run stopped, as recorded on a job or as the last
 * result of an automation, mapped to the message keys that explain each one in plain words.
 * A code that is not listed is never shown to the owner as it is.
 */
export const KNOWN_RESULTS = [
  "submitted",
  "simulated",
  "retry",
  "failed",
  "uncertain",
  "business_inactive",
  "automation_disabled",
  "invalid_phone",
  "opted_out",
  "already_submitted",
  "max_attempts",
  "legal_basis",
  "customer_reply",
  "lead_closed",
  "human_contact",
  "recovery_sms_disabled",
  "stale",
  "quiet_hours",
  "template_incomplete",
  "missing_sender",
  "quote_accepted",
  "quote_rejected",
  "quote_stopped",
  "quote_not_found",
  "manual",
] as const;

export type KnownResult = (typeof KNOWN_RESULTS)[number];

export function isKnownResult(value: string | undefined): value is KnownResult {
  return value !== undefined && (KNOWN_RESULTS as readonly string[]).includes(value);
}

/**
 * Turns a number of minutes into whole days, hours and minutes, the largest units first,
 * for the hint under a timing box ("1,440 minutes" is "1 day"). Zero parts are left out.
 */
export function splitMinutes(total: number): { days: number; hours: number; minutes: number } {
  const safe = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  return {
    days: Math.floor(safe / 1440),
    hours: Math.floor((safe % 1440) / 60),
    minutes: safe % 60,
  };
}
