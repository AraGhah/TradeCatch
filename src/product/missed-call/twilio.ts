import type { OutboundSms, SmsPort } from "./types";

/** In-memory SMS port for tests and local dry-runs. */
export function createMemorySmsPort(): SmsPort & {
  sent: OutboundSms[];
} {
  const sent: OutboundSms[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { sid: `SM_mem_${sent.length}` };
    },
  };
}

/**
 * Twilio REST SMS sender. Requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.
 * Falls back to logging when unset (non-production dry-run).
 */
export function createTwilioSmsPort(env = process.env): SmsPort {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();

  return {
    async send(message) {
      if (!sid || !token) {
        console.info("[missed-call] SMS dry-run (Twilio unset)", {
          to: message.toE164,
          body: message.body.slice(0, 80),
        });
        return { sid: `SM_dry_${Date.now()}` };
      }

      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const body = new URLSearchParams({
        To: message.toE164,
        From: message.fromE164,
        Body: message.body,
      });
      if (message.mediaUrl) body.set("MediaUrl", message.mediaUrl);

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Twilio SMS failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { sid: string };
      return { sid: json.sid };
    },
  };
}

/** Validate Twilio request signature (X-Twilio-Signature). */
export async function validateTwilioSignature(input: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string>;
}): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const data =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((k) => k + input.params[k])
      .join("");
  const expected = createHmac("sha1", input.authToken)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
