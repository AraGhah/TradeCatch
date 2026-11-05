/**
 * SIP hand-off from a Twilio webhook call to the LiveKit voice agent.
 *
 * Production numbers normally reach LiveKit straight through the Twilio
 * Elastic SIP trunk, which bypasses TradeCatch's webhooks. Missed-calls-only
 * needs TradeCatch to ring the contractor first, so such a number points at
 * the voice webhook instead, and when nobody answers, the webhook bridges the
 * caller to the same LiveKit agent with `<Dial><Sip>`.
 *
 * Configuration (all server-side env, never sent to the browser or logged):
 * - RECEPTIONIST_LIVEKIT_SIP_HOST       e.g. "abc123.sip.livekit.cloud"
 * - RECEPTIONIST_LIVEKIT_SIP_TRANSPORT  optional: "tls" | "tcp" | "udp"
 * - RECEPTIONIST_LIVEKIT_SIP_USERNAME   optional, with the password, when the
 * - RECEPTIONIST_LIVEKIT_SIP_PASSWORD   LiveKit inbound trunk uses digest auth
 */

export type LivekitSipTarget = {
  host: string;
  transport?: "tls" | "tcp" | "udp";
  username?: string;
  password?: string;
};

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?$/i;
const E164 = /^\+[1-9]\d{7,14}$/;

/** Why the hand-off is unavailable, as a stable code (no values). */
export type LivekitSipProblem =
  | "missing_host"
  | "invalid_host"
  | "incomplete_credentials"
  | "invalid_transport";

export function livekitSipConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; target: LivekitSipTarget } | { ok: false; problem: LivekitSipProblem } {
  const host = env.RECEPTIONIST_LIVEKIT_SIP_HOST?.trim();
  if (!host) return { ok: false, problem: "missing_host" };
  if (!HOST.test(host)) return { ok: false, problem: "invalid_host" };
  const username = env.RECEPTIONIST_LIVEKIT_SIP_USERNAME?.trim() || undefined;
  const password = env.RECEPTIONIST_LIVEKIT_SIP_PASSWORD?.trim() || undefined;
  if (Boolean(username) !== Boolean(password)) {
    return { ok: false, problem: "incomplete_credentials" };
  }
  const rawTransport = env.RECEPTIONIST_LIVEKIT_SIP_TRANSPORT?.trim().toLowerCase();
  let transport: LivekitSipTarget["transport"];
  if (rawTransport) {
    if (rawTransport !== "tls" && rawTransport !== "tcp" && rawTransport !== "udp") {
      return { ok: false, problem: "invalid_transport" };
    }
    transport = rawTransport;
  }
  return { ok: true, target: { host, transport, username, password } };
}

export function livekitHandoffReady(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return livekitSipConfig(env).ok;
}

/**
 * The SIP URI for one call. The user part is the business number the caller
 * dialed, which is what the LiveKit inbound trunk and the agent's config
 * lookup (`sip.trunkPhoneNumber`) key on. Returns null for anything that is
 * not a plain E.164 number, so caller input can never shape the URI.
 */
export function livekitSipUri(
  calledE164: string,
  target: LivekitSipTarget,
): string | null {
  const number = calledE164.trim();
  if (!E164.test(number)) return null;
  const transport = target.transport ? `;transport=${target.transport}` : "";
  return `sip:${number}@${target.host}${transport}`;
}
