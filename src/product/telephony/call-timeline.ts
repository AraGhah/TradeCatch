/**
 * Lifecycle events of a real call, beyond the ones written when it arrives:
 * what the ring did, and how the call ended.
 *
 * Every event has a stable id (`callEventId`), so a provider retry, or two
 * workers handling the same callback, write each row once. A failure here is
 * logged and swallowed: tracking must never fail a voice webhook.
 */

import { logReceptionistDiagnostic } from "@/product/receptionist/diagnostics";
import type { ReceptionistStore } from "@/product/receptionist/store";
import type { CallSession, VoicePlan } from "@/product/receptionist/types";
import { callEventId, type CallEventStore } from "./call-events";
import type { CallEventKind } from "./types";

export type SimulationFinalStatus =
  | "completed"
  | "transferred"
  | "caller_hung_up"
  | "voicemail"
  | "failed";

export type CallTermination = {
  reason: string;
  by: "caller" | "receptionist" | "contractor" | "system";
};

/** How a finished call ended, from its stored outcome. Shared by real calls and simulations. */
export function describeCallEnd(session: Pick<CallSession, "outcome">): {
  finalStatus: SimulationFinalStatus;
  termination: CallTermination;
} {
  switch (session.outcome) {
    case "transferred":
    case "emergency_transferred":
      return {
        finalStatus: "transferred",
        termination: { reason: "answered_by_contractor", by: "contractor" },
      };
    case "caller_hung_up":
      return {
        finalStatus: "caller_hung_up",
        termination: { reason: "caller_hung_up", by: "caller" },
      };
    case "voicemail":
      return {
        finalStatus: "voicemail",
        termination: { reason: "voicemail_recorded", by: "caller" },
      };
    case "failed":
      return {
        finalStatus: "failed",
        termination: { reason: "call_failed", by: "system" },
      };
    default:
      return {
        finalStatus: "completed",
        termination: { reason: "completed_by_receptionist", by: "receptionist" },
      };
  }
}

type Deps = { store: ReceptionistStore; events: CallEventStore };

function scopeOf(session: CallSession) {
  return {
    organizationId: session.configId.replace(/^rc_org_/, ""),
    clientAccountId: session.clientAccountId,
    callSid: session.callSid,
    sessionId: session.id,
  };
}

function write(
  deps: Deps,
  session: CallSession,
  kind: CallEventKind,
  part: string | number | undefined,
  detail: string | undefined,
  payload?: Record<string, unknown>,
) {
  return deps.events.append({
    ...scopeOf(session),
    id: callEventId(session.callSid, kind, part),
    kind,
    detail,
    payload,
  });
}

/** After a `<Dial>` finished: a missed ring-first call (and the receptionist taking over) or a transfer result. */
export async function recordDialEvents(
  deps: Deps,
  sessionId: string,
  plan: VoicePlan,
): Promise<void> {
  let callSid: string | undefined;
  try {
    const session = await deps.store.getSession(sessionId);
    if (!session) return;
    callSid = session.callSid;
    const leg = session.transfers.at(-1);
    if (!leg) return;
    const count = session.transfers.length;
    const ringFirst = leg.reason === "human_first" || leg.reason === "overflow_ring";
    if (ringFirst && leg.status !== "completed") {
      await write(deps, session, "missed", count, `ring_${leg.status}`);
      if (plan.verbs.some((v) => v.verb === "gather")) {
        await write(deps, session, "ai_started", "after_ring", `after_ring_${leg.status}`);
      }
      return;
    }
    await write(
      deps,
      session,
      "transfer_result",
      count,
      ringFirst ? "human_answered" : leg.status,
    );
  } catch (err) {
    logReceptionistDiagnostic({
      event: "call_event_write_failed",
      step: "dial",
      callSid,
      error: err,
    });
  }
}

/** After the provider's final status: the status itself and, once recorded, how the call ended. */
export async function recordFinalEvents(
  deps: Deps,
  callSid: string,
  callStatus: string,
): Promise<void> {
  try {
    const session = await deps.store.getSessionByCallSid(callSid);
    if (!session) return;
    const status = callStatus.toLowerCase();
    await write(deps, session, "status", status, status, {
      durationSeconds: session.durationSeconds,
    });
    if (!session.finalizedAt) return;
    const { finalStatus, termination } = describeCallEnd(session);
    await write(deps, session, "finalized", undefined, session.outcome, {
      finalStatus,
      outcome: session.outcome,
      termination,
      durationSeconds: session.durationSeconds,
      endedAt: session.endedAt,
    });
  } catch (err) {
    logReceptionistDiagnostic({
      event: "call_event_write_failed",
      step: "status",
      callSid,
      error: err,
    });
  }
}
