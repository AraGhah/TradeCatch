/**
 * Authentication for the ConversationRelay socket, in Web Crypto only so the
 * same code runs in the Worker entry, the Durable Object and the Next routes.
 *
 * - The WebSocket upgrade carries X-Twilio-Signature: HMAC-SHA1 of the socket
 *   URL with the account auth token, the same scheme as Twilio webhooks.
 * - Each turn the Durable Object forwards to /api/voice/relay/turn is signed
 *   with an HMAC-SHA256 derived from the same token, bound to a timestamp, so
 *   the turn route can be public without being callable by anyone else.
 */

const encoder = new TextEncoder();
const TURN_CONTEXT = "tradecatch.voice-relay.turn.v1";
export const RELAY_TURN_HEADER = "x-tradecatch-relay-signature";
const TURN_MAX_AGE_MS = 60_000;

async function hmac(
  hash: "SHA-1" | "SHA-256",
  key: string,
  message: string,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time for equal lengths; lengths are not secret here. */
function equalStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The URLs Twilio may have signed: the wss:// URL written in the TwiML (built
 * from the public webhook base) and the https:// form the Worker sees.
 */
export function relaySocketUrlCandidates(
  requestUrl: string,
  publicBase: string | undefined,
): string[] {
  const url = new URL(requestUrl);
  const suffix = `${url.pathname}${url.search}`;
  const origins = new Set<string>();
  const base = publicBase?.trim().replace(/\/$/, "");
  if (base) origins.add(base);
  origins.add(url.origin);
  const candidates = new Set<string>();
  for (const origin of origins) {
    candidates.add(`${origin.replace(/^http/, "ws")}${suffix}`);
    candidates.add(`${origin.replace(/^ws/, "http")}${suffix}`);
  }
  return [...candidates];
}

export async function validateTwilioSocketSignature(input: {
  authToken: string;
  signature: string;
  urls: string[];
}): Promise<boolean> {
  if (!input.authToken || !input.signature) return false;
  let ok = false;
  for (const url of input.urls) {
    // A WebSocket upgrade has no form body, so only the URL is signed.
    const expected = toBase64(await hmac("SHA-1", input.authToken, url));
    if (equalStrings(expected, input.signature)) ok = true;
  }
  return ok;
}

export async function signRelayTurn(
  authToken: string,
  body: string,
  now: number = Date.now(),
): Promise<string> {
  const mac = await hmac("SHA-256", authToken, `${TURN_CONTEXT}.${now}.${body}`);
  return `t=${now},v1=${toHex(mac)}`;
}

export async function verifyRelayTurn(input: {
  authToken: string | undefined;
  header: string | null;
  body: string;
  now?: number;
}): Promise<boolean> {
  const token = input.authToken?.trim();
  if (!token || !input.header) return false;
  const match = /^t=(\d{10,16}),v1=([0-9a-f]{64})$/.exec(input.header.trim());
  if (!match) return false;
  const signedAt = Number(match[1]);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(signedAt) || Math.abs(now - signedAt) > TURN_MAX_AGE_MS) {
    return false;
  }
  const mac = await hmac("SHA-256", token, `${TURN_CONTEXT}.${signedAt}.${input.body}`);
  return equalStrings(toHex(mac), match[2]!);
}
