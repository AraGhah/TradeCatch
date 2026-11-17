/**
 * Everything the owner should see on the call screen, from both call paths.
 *
 * A business's calls live in two places: the receptionist's sessions, and
 * Module A's missed-call text-back calls (numbers bought through provisioning
 * point at Module A, which never writes a receptionist session). Reading both
 * here keeps a real call from being missing just because of which path took it.
 *
 * Read-only: Module A calls are converted when listed and never written into
 * the receptionist's table, so there is nothing to backfill and nothing to
 * duplicate. A call both paths know (the same provider call id) is shown once,
 * as the receptionist's richer record.
 */

import { receptionistErrorCode } from "./diagnostics";
import { ownerVisibleCalls } from "./call-history";
import type { MissedCallStore } from "@/product/missed-call/store";
import type { CallRecord } from "@/product/missed-call/types";
import type { ReceptionistStore } from "./store";
import type { CallSession } from "./types";

/** How many calls of each kind are read for one screen. */
export const CALL_FEED_LIMIT = 200;

/**
 * One Module A call as a list entry. Only what Module A recorded is shown: no
 * dialed number, no outcome, no summary and no start/end beyond the time it
 * called, because Module A never captured them.
 */
export function missedCallAsSession(
  call: CallRecord,
  config: { id: string },
): CallSession {
  const at = call.calledAt;
  return {
    id: `mc_${call.id}`,
    callSid: call.twilioCallSid ?? `mc_${call.id}`,
    configId: config.id,
    clientAccountId: call.clientAccountId,
    fromE164: call.callerE164,
    toE164: "",
    language: "en",
    status: "completed",
    step: "done",
    afterHours: call.disposition === "after_hours_missed",
    slots: {},
    turns: [],
    silenceCount: 0,
    callerTurnCount: 0,
    transfers: [],
    notifications: [],
    activity: {
      provider: "twilio",
      direction: "inbound",
      origin: "missed_call",
      disposition: call.disposition,
    },
    durationSeconds: call.durationSeconds,
    startedAt: at,
    updatedAt: at,
    finalizedAt: at,
    version: 1,
  };
}

export type CallFeed = {
  calls: CallSession[];
  /** Module A's calls could not be read: the list may be missing some. */
  missedCallsUnavailable: boolean;
};

/**
 * The owner's calls, newest first. A receptionist read failure throws (the
 * history is unknown, say so); a Module A read failure is reported in
 * `missedCallsUnavailable` and the receptionist's calls are still returned.
 *
 * `clientAccountId` must come from the signed-in business, never the request:
 * both stores are asked for that one business only.
 */
export async function loadCallFeed(input: {
  clientAccountId: string;
  receptionist: ReceptionistStore;
  missedCall: () => MissedCallStore;
  limit?: number;
}): Promise<CallFeed> {
  const limit = input.limit ?? CALL_FEED_LIMIT;
  const sessions = await input.receptionist.listSessions({
    clientAccountId: input.clientAccountId,
    limit,
  });

  let records: CallRecord[] = [];
  let missedCallsUnavailable = false;
  try {
    records = await input.missedCall().listCalls(input.clientAccountId, limit);
  } catch (err) {
    missedCallsUnavailable = true;
    console.error(
      JSON.stringify({
        event: "tradecatch.calls.missed_call_list_failed",
        errorCode: receptionistErrorCode(err),
      }),
    );
  }

  // Every provider call id the receptionist knows, hidden routing records
  // included: the agent's own record of a handed-off call stands for it.
  const known = new Set(sessions.map((s) => s.callSid));
  const extra = records
    // Defense in depth: never list another business's call, whatever the store returned.
    .filter((r) => r.clientAccountId === input.clientAccountId)
    .filter((r) => !r.twilioCallSid || !known.has(r.twilioCallSid))
    .map((r) => missedCallAsSession(r, { id: `mc_${input.clientAccountId}` }));

  return {
    calls: ownerVisibleCalls([...sessions, ...extra]),
    missedCallsUnavailable,
  };
}
