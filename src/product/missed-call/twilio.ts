import type { OutboundSms, SmsPort } from "./types";

/** In-memory SMS port for tests and explicitly selected local dry-runs. */
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
    async syncOptOut() {
      return { ok: true, detail: "memory" };
    },
  };
}

/**
 * Explicit dry-run adapter. Only used when MISSED_CALL_SMS_MODE=dry-run
 * (or when createTwilioSmsPort is constructed in non-production without credentials).
 * Never silently selected in production.
 */
export function createDryRunSmsPort(): SmsPort {
  return {
    async send(message) {
      console.info("[missed-call] SMS dry-run", {
        to: message.toE164,
        body: message.body.slice(0, 80),
      });
      return { sid: `SM_dry_${Date.now()}` };
    },
    async syncOptOut(input) {
      console.info("[missed-call] SMS opt-out dry-run", input.phoneE164);
      return { ok: true, detail: "dry-run" };
    },
  };
}

export function isTwilioSmsConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim(),
  );
}

/**
 * Twilio REST SMS sender.
 *
 * Production: requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN; missing config
 * throws on send (never returns a fake success SID).
 * Development: falls back to dry-run only when credentials are unset.
 * Set MISSED_CALL_SMS_MODE=dry-run to force dry-run outside production.
 */
export function createTwilioSmsPort(
  env: NodeJS.ProcessEnv = process.env,
): SmsPort {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const forceDryRun = env.MISSED_CALL_SMS_MODE === "dry-run";
  const isProd = env.NODE_ENV === "production";

  if (forceDryRun && !isProd) {
    return createDryRunSmsPort();
  }

  if (!sid || !token) {
    if (isProd) {
      return {
        async send() {
          throw new Error(
            "Twilio SMS is not configured in production (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
          );
        },
      };
    }
    return createDryRunSmsPort();
  }

  return {
    async send(message) {
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const body = new URLSearchParams({
        To: message.toE164,
        From: message.fromE164,
        Body: message.body,
      });
      if (message.mediaUrl) body.set("MediaUrl", message.mediaUrl);

      const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/$/, "");
      if (siteUrl) {
        body.set("StatusCallback", `${siteUrl}/api/twilio/sms/status`);
        body.set("StatusCallbackMethod", "POST");
      }

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Twilio SMS failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { sid: string };
      return { sid: json.sid };
    },
    async syncOptOut(input) {
      // Advanced Opt-Out must be enabled on the Twilio number / Messaging Service.
      // We do not invent a "synced" status without a provider API confirmation.
      return {
        ok: true,
        detail: `local_observed_pending_provider_confirm:${input.phoneE164}:via:${input.fromE164}`,
      };
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
