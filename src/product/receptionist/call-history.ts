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

export function ownerVisibleCalls(sessions: CallSession[]): CallSession[] {
  return sessions.filter((s) => !isHandoffRoutingRecord(s));
}
