import {
  clientIpKey,
  getClientIp,
  takeToken,
  type RateLimitResult,
} from "./rate-limit";
import type { BucketSpec } from "./token-bucket";

/**
 * Every rate limit in TradeCatch, by name. A policy is a token bucket:
 * `capacity` requests may arrive at once, then one more is allowed every
 * `refillEveryMs`. Route handlers ask for a policy by name instead of
 * carrying their own numbers, so the limits live in one reviewable place and
 * docs/RATE_LIMITS.md can be checked against it.
 *
 * Reading the numbers: `perWindow(20, 15 * MIN)` is "20 at once, then one
 * every 45 seconds", which averages 20 per 15 minutes. Strictness is about
 * what a request costs when it goes wrong:
 *   auth      few attempts (password guessing, e-mail bombing)
 *   sms       texts cost money and reach real people
 *   payments  a double click must never become a double charge
 *   sensitive exports, API keys, voice cloning, admin actions
 *   api.*     the generous default for everything else (see below)
 */

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/** "limit requests per window": a burst of `limit`, refilling evenly over the window. */
function perWindow(limit: number, windowMs: number): BucketSpec {
  return { capacity: limit, refillEveryMs: windowMs / limit };
}

export type PolicyGroup =
  | "auth"
  | "sms"
  | "payments"
  | "sensitive"
  | "admin"
  | "public"
  | "tools"
  | "api";

export type Policy = BucketSpec & {
  group: PolicyGroup;
  /** Who shares one bucket. */
  per:
    | "ip"
    | "user"
    | "business+user"
    | "business+ip"
    | "number pair"
    | "number"
    | "other";
  /**
   * Bucket used when clients cannot be told apart (the shared `unknown`
   * address). Looser where every visitor shares it, stricter where the route
   * is a spam target and a shared bucket is the safer failure.
   */
  unknown?: BucketSpec;
  /** What the limit protects, in a sentence. */
  why: string;
};

export const POLICIES = {
  // --- Authentication: strictest, keyed by address or user ---------------
  "auth.password-login": {
    ...perWindow(20, 15 * MIN),
    unknown: perWindow(200, 15 * MIN),
    group: "auth",
    per: "ip",
    why: "Password guessing. Per-account lockout sits behind this.",
  },
  "auth.magic-link": {
    ...perWindow(5, 15 * MIN),
    group: "auth",
    per: "ip",
    why: "Sign-in e-mails sent to other people.",
  },
  "auth.forgot-password": {
    ...perWindow(5, 15 * MIN),
    unknown: perWindow(100, 15 * MIN),
    group: "auth",
    per: "ip",
    why: "Reset e-mails sent to other people.",
  },
  "auth.set-password": {
    ...perWindow(20, 15 * MIN),
    unknown: perWindow(200, 15 * MIN),
    group: "auth",
    per: "ip",
    why: "Guessing reset tokens.",
  },
  "auth.callback": {
    ...perWindow(60, 10 * MIN),
    unknown: perWindow(600, 10 * MIN),
    group: "auth",
    per: "ip",
    why: "Guessing magic-link tokens.",
  },
  "auth.change-password": {
    ...perWindow(20, 15 * MIN),
    group: "auth",
    per: "user",
    why: "Guessing the current password from a stolen session.",
  },
  "auth.mfa": {
    ...perWindow(20, 15 * MIN),
    group: "auth",
    per: "other",
    why: "Guessing the second factor (user and address).",
  },

  // --- SMS: costs money and reaches real people --------------------------
  "sms.conversation": {
    ...perWindow(20, HOUR),
    group: "sms",
    per: "number pair",
    why: "One abusive caller driving Twilio spend. Owner alerts are exempt.",
  },
  "sms.sender": {
    // 200 at once, then one every 20 seconds (180 an hour): far above a real
    // busy day, far below a runaway loop. A refused text is retried later,
    // not dropped (see SmsRateLimitError).
    capacity: 200,
    refillEveryMs: 20 * SEC,
    group: "sms",
    per: "number",
    why: "A bug or loop texting customers from one business number.",
  },
  "sms.live-test": {
    ...perWindow(5, HOUR),
    group: "sms",
    per: "business+user",
    why: "Test button that sends a real text.",
  },

  // --- Payments ----------------------------------------------------------
  "payments.checkout": {
    ...perWindow(5, 10 * MIN),
    group: "payments",
    per: "business+user",
    why: "Repeated Stripe Checkout sessions. Duplicates are also blocked by a pending-checkout claim and a Stripe idempotency key.",
  },
  "payments.portal": {
    ...perWindow(5, 10 * MIN),
    group: "payments",
    per: "business+user",
    why: "Repeated Stripe billing portal sessions.",
  },

  // --- Sensitive operations ----------------------------------------------
  "sensitive.api-key-create": {
    ...perWindow(10, HOUR),
    group: "sensitive",
    per: "business+user",
    why: "Minting credentials.",
  },
  "sensitive.account-export": {
    ...perWindow(3, HOUR),
    group: "sensitive",
    per: "business+user",
    why: "Bulk export of a business's data.",
  },
  "sensitive.website-service": {
    ...perWindow(5, HOUR),
    group: "sensitive",
    per: "business+user",
    why: "Paid website service requests.",
  },
  "sensitive.referral-link": {
    ...perWindow(20, 10 * MIN),
    group: "sensitive",
    per: "business+user",
    why: "Referral link minting.",
  },
  "sensitive.voice-challenge": {
    ...perWindow(10, HOUR),
    group: "sensitive",
    per: "business+user",
    why: "Voice-clone consent challenges.",
  },
  "sensitive.voice-clone": {
    ...perWindow(6, HOUR),
    group: "sensitive",
    per: "business+user",
    why: "Voice cloning (paid third-party call, biometric data).",
  },
  "sensitive.voice-preview": {
    ...perWindow(20, 10 * MIN),
    group: "sensitive",
    per: "business+user",
    why: "Paid text-to-speech previews.",
  },
  "sensitive.voice-mode": {
    ...perWindow(30, 10 * MIN),
    group: "sensitive",
    per: "business+user",
    why: "Switching between the standard and a cloned voice.",
  },
  "sensitive.voice-delete": {
    ...perWindow(20, 10 * MIN),
    group: "sensitive",
    per: "business+user",
    why: "Deleting a cloned voice.",
  },
  "sensitive.voice-revoke": {
    ...perWindow(20, 10 * MIN),
    group: "sensitive",
    per: "business+user",
    why: "Voice consent revocation.",
  },

  // --- Admin --------------------------------------------------------------
  "admin.installations": {
    ...perWindow(30, MIN),
    group: "admin",
    per: "user",
    why: "Installation approvals.",
  },
  "admin.referrals": {
    ...perWindow(60, MIN),
    group: "admin",
    per: "user",
    why: "Referral reward administration.",
  },

  // --- Public forms and anonymous endpoints -------------------------------
  "public.book-audit": {
    ...perWindow(5, 10 * MIN),
    unknown: perWindow(2, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Form spam; every submission e-mails the team.",
  },
  "public.website-request": {
    ...perWindow(5, 10 * MIN),
    unknown: perWindow(2, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Form spam.",
  },
  "public.referral-submit": {
    ...perWindow(5, 10 * MIN),
    unknown: perWindow(2, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Form spam.",
  },
  "public.website-leads-ip": {
    ...perWindow(120, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Lead intake from customer websites, per address.",
  },
  "public.website-leads-key": {
    ...perWindow(30, 10 * MIN),
    group: "public",
    per: "other",
    why: "Lead intake from customer websites, per API key and address.",
  },
  "public.client-error": {
    ...perWindow(12, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Browser error reports are anonymous and unbounded otherwise.",
  },
  "public.receptionist-demo": {
    ...perWindow(120, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Marketing-site demo chat (model calls cost money).",
  },
  "public.demo-voice": {
    ...perWindow(30, 10 * MIN),
    group: "public",
    per: "ip",
    why: "Marketing-site demo voice (text-to-speech costs money).",
  },
  "public.installation-verify": {
    ...perWindow(600, MIN),
    group: "public",
    per: "ip",
    why: "Installation checks run by customer websites.",
  },
  "public.calendar-hook": {
    ...perWindow(60, MIN),
    group: "public",
    per: "business+ip",
    why: "Calendar change notifications.",
  },

  // --- Test tools in the dashboard ----------------------------------------
  "tools.call-test": {
    ...perWindow(10, 10 * MIN),
    group: "tools",
    per: "business+user",
    why: "Simulated calls.",
  },
  "tools.notification-test": {
    ...perWindow(20, 10 * MIN),
    group: "tools",
    per: "business+user",
    why: "Test notifications.",
  },
  "tools.automation-test": {
    ...perWindow(30, 10 * MIN),
    group: "tools",
    per: "business+user",
    why: "Automation dry runs.",
  },
  "tools.receptionist-test": {
    ...perWindow(60, 10 * MIN),
    group: "tools",
    per: "business+user",
    why: "Receptionist test chat (model calls cost money).",
  },

  // --- Defaults for every other /api route (rate-limit-central.ts) --------
  // Per address. Deliberately generous: these catch loops and floods, not
  // ordinary use. A dashboard tab polls about once every 20 seconds; a person
  // saving forms makes a few writes a minute. The routes above carry the
  // strict limits.
  "api.write": {
    capacity: 60,
    refillEveryMs: 1 * SEC,
    group: "api",
    per: "ip",
    why: "Default for POST/PUT/PATCH/DELETE: 60 at once, then 1 a second.",
  },
  "api.read": {
    capacity: 240,
    refillEveryMs: 125,
    group: "api",
    per: "ip",
    why: "Default for GET/HEAD: 240 at once, then 8 a second.",
  },
} as const satisfies Record<string, Policy>;

/** "1 per 45 s", "1 per 2 min", "8 per s": how fast a policy's bucket refills, for docs and logs. */
export function describeRefill(refillEveryMs: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (refillEveryMs >= HOUR) return `1 per ${trim(refillEveryMs / HOUR)} h`;
  if (refillEveryMs >= MIN) return `1 per ${trim(refillEveryMs / MIN)} min`;
  if (refillEveryMs >= SEC) return `1 per ${trim(refillEveryMs / SEC)} s`;
  return `${trim(SEC / refillEveryMs)} per s`;
}

export type PolicyId = keyof typeof POLICIES;

/** Who a limit applies to. */
export type Subject =
  { request: Request } | { ip: string } | { subject: string };

function resolveSubject(who: Subject, env: Record<string, string | undefined>) {
  if ("subject" in who) return { subject: who.subject, unknown: false };
  const ip = "request" in who ? getClientIp(who.request, env) : who.ip;
  return { subject: clientIpKey(ip), unknown: ip.startsWith("unknown") };
}

/** Spend one token from policy `id` for `who`. Never throws for an unavailable store. */
export function consumePolicy(
  id: PolicyId,
  who: Subject,
  env: Record<string, string | undefined> = process.env,
  cost = 1,
  options: { postgres?: boolean } = {},
): Promise<RateLimitResult> {
  const policy: Policy = POLICIES[id];
  const { subject, unknown } = resolveSubject(who, env);
  const spec = unknown && policy.unknown ? policy.unknown : policy;
  return takeToken({
    key: `${id}:${subject}`,
    spec: { capacity: spec.capacity, refillEveryMs: spec.refillEveryMs },
    cost,
    env,
    postgres: options.postgres,
  });
}

// --- What the default limits cover ---------------------------------------

export type RouteClass =
  | { kind: "exempt"; reason: string }
  | { kind: "limited"; policy: "api.read" | "api.write" };

/**
 * Routes that no per-address limit may touch. Every one is called by a
 * provider or by our own voice agent, not by a person's browser: they share a
 * handful of server addresses (so one bucket would throttle every business at
 * once) and a refused request would drop or cut a live call. Each is
 * authenticated by a provider signature or a shared secret instead; a unit
 * test checks that.
 */
export const EXEMPT_API_PREFIXES: ReadonlyArray<{
  prefix: string;
  reason: string;
}> = [
  {
    prefix: "/api/twilio/",
    reason: "Twilio voice and SMS webhooks: signature-verified, real-time",
  },
  {
    prefix: "/api/webhooks/",
    reason:
      "Stripe, Twilio, Gmail and Google Calendar webhooks: signature- or secret-verified, shared provider addresses",
  },
  {
    prefix: "/api/voice/",
    reason: "Live call media socket",
  },
  {
    prefix: "/api/receptionist/agent/",
    reason: "Voice agent tool calls during a live call",
  },
  {
    prefix: "/api/receptionist/agent-config",
    reason: "Voice agent configuration fetch at call start",
  },
  {
    prefix: "/api/health",
    reason: "Uptime and readiness probes",
  },
];

export function classifyApiRequest(
  method: string,
  pathname: string,
): RouteClass {
  const upper = method.toUpperCase();
  if (upper === "OPTIONS") {
    return { kind: "exempt", reason: "CORS preflight carries no action" };
  }
  for (const { prefix, reason } of EXEMPT_API_PREFIXES) {
    const base = prefix.replace(/\/$/, "");
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      return { kind: "exempt", reason };
    }
  }
  return {
    kind: "limited",
    policy: upper === "GET" || upper === "HEAD" ? "api.read" : "api.write",
  };
}
