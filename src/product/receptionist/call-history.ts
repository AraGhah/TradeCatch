import { isWithheldCaller } from "@/lib/phone";
import { phoneKey } from "@/product/crm/phone";
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

/** The agent's conversation record may begin a little before, or well after, the webhook's record. */
const REPORT_BEFORE_MS = 60_000;
const REPORT_AFTER_MS = 15 * 60_000;

function isAgentConversation(session: CallSession): boolean {
  return session.callSid.startsWith("lk_");
}

/** True when two records could be the same caller (a withheld number matches any). */
function sameCaller(a: CallSession, b: CallSession): boolean {
  if (isWithheldCaller(a.fromE164) || isWithheldCaller(b.fromE164)) return true;
  const ka = phoneKey(a.fromE164);
  return ka.length >= 10 && ka === phoneKey(b.fromE164);
}

/**
 * The routing records whose conversation the agent has reported. Each call is
 * paired with at most one report (closest in time first), so two calls from
 * one number, or two withheld callers at once, never hide each other.
 */
function reportedHandoffs(sessions: CallSession[]): Set<string> {
  const routing = sessions.filter(isHandoffRoutingRecord);
  const agents = sessions.filter(isAgentConversation);
  const pairs: { routing: CallSession; agent: CallSession; gap: number }[] = [];
  for (const r of routing) {
    for (const a of agents) {
      if (a.clientAccountId !== r.clientAccountId || !sameCaller(r, a)) continue;
      const delta = Date.parse(a.startedAt) - Date.parse(r.startedAt);
      if (!(delta >= -REPORT_BEFORE_MS && delta <= REPORT_AFTER_MS)) continue;
      pairs.push({ routing: r, agent: a, gap: Math.abs(delta) });
    }
  }
  pairs.sort((x, y) => x.gap - y.gap || x.routing.id.localeCompare(y.routing.id));
  const claimedRouting = new Set<string>();
  const claimedAgents = new Set<string>();
  for (const { routing: r, agent: a } of pairs) {
    if (claimedRouting.has(r.id) || claimedAgents.has(a.id)) continue;
    claimedRouting.add(r.id);
    claimedAgents.add(a.id);
  }
  return claimedRouting;
}

/**
 * What the owner sees, newest first. A call handed to the voice agent leaves
 * two records; the routing one is hidden only once the agent's own report of
 * the conversation exists. If the report never arrives (agent crash, webhook
 * not configured), the routing record stays visible so a real call is never
 * silently missing.
 */
export function ownerVisibleCalls(sessions: CallSession[]): CallSession[] {
  const reported = reportedHandoffs(sessions);
  return sessions
    .filter(
      (s) =>
        !isPracticeCall(s) && (!isHandoffRoutingRecord(s) || !reported.has(s.id)),
    )
    .sort(
      (a, b) =>
        Date.parse(b.startedAt) - Date.parse(a.startedAt) ||
        b.id.localeCompare(a.id),
    );
}
