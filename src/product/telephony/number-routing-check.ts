/**
 * Read-only: where does Twilio send the TradeCatch number's voice calls?
 *
 * One GET on the account's IncomingPhoneNumbers, filtered to the number. It
 * never changes the number, the trunk or any routing. Credentials come from
 * the server environment and are never returned or logged; the result is one
 * of four words.
 */

import type { NumberRouting } from "./ai-call-handling";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const VOICE_PATHS = [
  "/api/webhooks/twilio/voice",
  "/api/twilio/voice/receptionist/incoming",
];

export function classifyNumberRouting(
  record: {
    trunk_sid?: string | null;
    voice_url?: string | null;
    voice_application_sid?: string | null;
  } | null,
  webhookBase: string | null,
): NumberRouting {
  if (!record) return "unknown";
  if (record.trunk_sid) return "sip_trunk";
  const url = (record.voice_url ?? "").trim();
  if (!url) return "elsewhere";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "elsewhere";
  }
  if (!VOICE_PATHS.includes(parsed.pathname.replace(/\/$/, ""))) return "elsewhere";
  if (webhookBase) {
    try {
      if (new URL(webhookBase).host !== parsed.host) return "elsewhere";
    } catch {
      return "unknown";
    }
  }
  return "webhook";
}

export async function checkNumberRouting(
  numberE164: string,
  opts: { env?: NodeJS.ProcessEnv; fetch?: Fetch; timeoutMs?: number } = {},
): Promise<NumberRouting> {
  const env = opts.env ?? process.env;
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token || !/^AC[0-9a-fA-F]{32}$/.test(sid)) return "unknown";
  if (!/^\+[1-9]\d{7,14}$/.test(numberE164)) return "unknown";
  const doFetch = opts.fetch ?? fetch;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(numberE164)}&PageSize=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as {
      incoming_phone_numbers?: {
        trunk_sid?: string | null;
        voice_url?: string | null;
        voice_application_sid?: string | null;
      }[];
    };
    const record = body.incoming_phone_numbers?.[0] ?? null;
    const base = env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() || null;
    return classifyNumberRouting(record, base);
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
