/**
 * Twilio phone number search / purchase / release for Module A.
 *
 * Purchasing a number charges the Twilio account real money every time it
 * runs and is not easily reversible (releasing stops billing but cannot
 * undo it having been billed) — every call site must be behind an explicit,
 * authorized action, never triggered automatically from untrusted or
 * unauthenticated input. See provisionOrganizationSmsNumber() in this file
 * for the one place that actually calls purchaseNumber(), and the ops-only
 * route at /api/missed-call/ops/provision-number for the one place that
 * calls that.
 *
 * A2P 10DLC / carrier registration is intentionally NOT automated here: it
 * requires submitting the organization's real legal business identity to
 * Twilio Trust Hub / The Campaign Registry, a business decision with real
 * compliance and cost implications that this code cannot make on an org's
 * behalf. Numbers work without it, but may see carrier filtering or
 * throughput limits on US traffic until it's completed through Twilio's
 * own console or a dedicated, human-reviewed onboarding step.
 */

export class NumberProvisioningError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function twilioCredentials(env: NodeJS.ProcessEnv) {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) {
    throw new NumberProvisioningError(
      "Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
      503,
    );
  }
  return { sid, token };
}

function authHeader(sid: string, token: string) {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

function webhookBase(env: NodeJS.ProcessEnv): string {
  const base =
    env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() ||
    env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!base) {
    throw new NumberProvisioningError(
      "MISSED_CALL_PUBLIC_WEBHOOK_BASE (or NEXT_PUBLIC_SITE_URL) must be set before purchasing a number.",
      503,
    );
  }
  return base.replace(/\/$/, "");
}

export type AvailableNumber = {
  phoneNumberE164: string;
  friendlyName: string;
  locality?: string;
  region?: string;
};

/** Read-only Twilio lookup. Never purchases or spends anything. */
export async function searchAvailableNumbers(
  input: { country?: "CA" | "US"; areaCode?: string; limit?: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AvailableNumber[]> {
  const { sid, token } = twilioCredentials(env);
  const country = input.country ?? "CA";
  const params = new URLSearchParams({
    SmsEnabled: "true",
    VoiceEnabled: "true",
    PageSize: String(Math.min(Math.max(input.limit ?? 5, 1), 20)),
  });
  if (input.areaCode?.trim()) params.set("AreaCode", input.areaCode.trim());

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/${country}/Local.json?${params}`,
    {
      headers: { Authorization: authHeader(sid, token) },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new NumberProvisioningError(
      `Twilio number search failed: ${res.status} ${await res.text()}`,
      502,
    );
  }
  const json = (await res.json()) as {
    available_phone_numbers?: Array<{
      phone_number: string;
      friendly_name: string;
      locality?: string;
      region?: string;
    }>;
  };
  return (json.available_phone_numbers ?? []).map((n) => ({
    phoneNumberE164: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality,
    region: n.region,
  }));
}

/**
 * Purchases exactly the given number and points its SMS/voice webhooks at
 * this app. Charges the Twilio account real money — only call this from an
 * explicit, authorized action (see the module docstring).
 */
export async function purchaseNumber(
  input: { phoneNumberE164: string; friendlyName: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ sid: string; phoneNumberE164: string }> {
  const { sid, token } = twilioCredentials(env);
  const base = webhookBase(env);
  const body = new URLSearchParams({
    PhoneNumber: input.phoneNumberE164,
    FriendlyName: input.friendlyName,
    SmsUrl: `${base}/api/twilio/sms/inbound`,
    SmsMethod: "POST",
    VoiceUrl: `${base}/api/twilio/voice/inbound`,
    VoiceMethod: "POST",
    StatusCallback: `${base}/api/twilio/voice/status`,
    StatusCallbackMethod: "POST",
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(sid, token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new NumberProvisioningError(
      `Twilio number purchase failed: ${res.status} ${await res.text()}`,
      502,
    );
  }
  const json = (await res.json()) as { sid: string; phone_number: string };
  return { sid: json.sid, phoneNumberE164: json.phone_number };
}

/**
 * Releases a previously purchased number — used to roll back a failed
 * provisioning attempt so a bad save never leaves an orphaned, still-billed
 * number. Never throws; a release failure is logged (no customer data) so
 * ops can clean it up by hand rather than masking the original error.
 */
export async function releaseNumber(
  numberSid: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let sid: string, token: string;
  try {
    ({ sid, token } = twilioCredentials(env));
  } catch {
    return;
  }
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`,
      {
        method: "DELETE",
        headers: { Authorization: authHeader(sid, token) },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok && res.status !== 404) {
      console.error(
        JSON.stringify({
          event: "tradecatch.twilio.number_release_failed",
          status: res.status,
        }),
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "tradecatch.twilio.number_release_error",
        message: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}
