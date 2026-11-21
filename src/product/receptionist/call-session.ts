/**
 * Pure call-session helpers for the receptionist engine: the record a call
 * starts from, provider-duration cleanup, flag/urgency merging and the
 * emergency-transfer rule. No store, clock or provider access.
 */

import { randomUUID } from "@/lib/id";
import { normalizeProviderNumber } from "@/lib/phone";
import { isAfterHours } from "@/product/missed-call/call-handling";
import type { UrgencyClassification } from "@/product/missed-call/types";
import type { CallFlags, CallSession, ReceptionistConfig } from "./types";

const URGENCY_RANK = { routine: 0, priority: 1, critical: 2 } as const;

/** A duration a provider reported, or undefined when it cannot be a real one. */
export function cleanDuration(seconds: number | undefined): number | undefined {
  return typeof seconds === "number" &&
    Number.isFinite(seconds) &&
    seconds >= 0 &&
    seconds <= 24 * 3600
    ? Math.round(seconds)
    : undefined;
}

/** A record with nothing in it but who called, when, and how it ended. */
export function bareSession(
  config: ReceptionistConfig,
  input: { callSid: string; fromE164: string; toE164: string },
  at: Date,
  extra: Partial<CallSession>,
): CallSession {
  const iso = at.toISOString();
  return {
    id: `rcs_${randomUUID()}`,
    callSid: input.callSid,
    configId: config.id,
    clientAccountId: config.clientAccountId,
    fromE164: normalizeProviderNumber(input.fromE164),
    toE164: normalizeProviderNumber(input.toE164),
    language: config.defaultLanguage,
    status: "in_progress",
    step: "reason",
    afterHours: isAfterHours(config, at),
    slots: {},
    turns: [],
    silenceCount: 0,
    callerTurnCount: 0,
    transfers: [],
    notifications: [],
    // Nobody follows up a call the receptionist never handled: no summary,
    // no text to the caller, no lead.
    routing: { quiet: true },
    startedAt: iso,
    updatedAt: iso,
    version: 1,
    ...extra,
  };
}

export function mergeFlags(
  session: CallSession,
  flags: Partial<CallFlags> | undefined,
): CallFlags | undefined {
  return flags ? { ...session.flags, ...flags } : session.flags;
}

export function mergeUrgency(
  current: UrgencyClassification | undefined,
  next: UrgencyClassification,
): UrgencyClassification {
  if (!current) return next;
  return URGENCY_RANK[next.level] > URGENCY_RANK[current.level]
    ? next
    : current;
}

export function emergencyTransferAllowed(
  config: ReceptionistConfig,
  session: CallSession,
) {
  if (!config.emergencyTransferE164) return false;
  return (
    !session.afterHours ||
    config.afterHoursMode === "take_message_emergency_transfer"
  );
}
