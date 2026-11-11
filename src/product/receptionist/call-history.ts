import type { CallSession } from "./types";

/**
 * A webhook call that was handed to the LiveKit agent leaves two records: the
 * routing record (this webhook session) and the agent's own report of the
 * conversation. Owners see the conversation once; the routing record stays
 * in the store for audits and exports.
 */
export function isHandoffRoutingRecord(session: CallSession): boolean {
  return session.routing?.handoff?.status === "connected";
}

/**
 * A practice conversation from the test tools ("Test Receptionist", the phone
 * simulation, the public demo). No phone rang: it is saved for audits only and
 * is never part of the owner's call activity, history or counts.
 */
export function isPracticeCall(session: Pick<CallSession, "callSid">): boolean {
  return (
    session.callSid.startsWith("sim_") || session.callSid.startsWith("demo_")
  );
}

export function ownerVisibleCalls(sessions: CallSession[]): CallSession[] {
  return sessions.filter(
    (s) => !isHandoffRoutingRecord(s) && !isPracticeCall(s),
  );
}
