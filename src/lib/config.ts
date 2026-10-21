import { isRealProductionRuntime } from "./environment";

/**
 * Production configuration guards.
 * Production booking intake requires bot protection and durable storage.
 * Email outages leave durable retry work rather than blocking saved leads.
 *
 * For deployment isolation (staging vs live), prefer helpers in
 * `@/lib/environment` — especially `isRealProductionRuntime()` and
 * `isStagingRuntime()`. `isProductionRuntime()` only means NODE_ENV=production
 * (includes the staging Worker build).
 */

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export {
  isDemoModeVisible,
  isOpsSandboxEnabled,
  isRealProductionRuntime,
  isStagingRuntime,
  resolveTradeCatchEnv,
  shouldUseDryRunSms,
} from "@/lib/environment";

export function isTurnstileConfigured(): boolean {
  return Boolean(
    process.env.TURNSTILE_SECRET_KEY?.trim() &&
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  );
}

export function isResendConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.RESEND_FROM_EMAIL &&
    (process.env.RESEND_NOTIFY_EMAIL?.trim() ||
      process.env.ADMIN_ALERT_EMAIL?.trim()),
  );
}

export function isLeadsWebhookConfigured(): boolean {
  return Boolean(process.env.LEADS_WEBHOOK_URL?.trim());
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim(),
  );
}

export function isDurableMissedCallStoreConfigured(): boolean {
  // Explicit opt-in only. DATABASE_URL alone must never claim readiness —
  // the Postgres adapter must also be selected via this flag.
  return process.env.MISSED_CALL_DURABLE_STORE === "1";
}

/** Playwright production harness — allows book-audit without live Resend/Turnstile. */
export function isE2eHarness(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (
    env.TRADECATCH_E2E !== "1" ||
    env.VERCEL_ENV?.toLowerCase() === "production"
  ) {
    return false;
  }

  try {
    const hostname = new URL(env.NEXT_PUBLIC_SITE_URL || "").hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export function requiresProductionLeadProtection(): boolean {
  return isProductionRuntime() && !isE2eHarness();
}

/** Staging production builds enforce the same boundary; only the local harness is exempt. */
export function getProductionConfigErrors(): string[] {
  if (!requiresProductionLeadProtection()) return [];
  const errors: string[] = [];
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!secret) errors.push("TURNSTILE_SECRET_KEY");
  if (!siteKey) errors.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  // Cloudflare's public dummy keys must never protect the live site.
  if (isRealProductionRuntime()) {
    if (
      [
        "1x0000000000000000000000000000000AA",
        "2x0000000000000000000000000000000AA",
        "3x0000000000000000000000000000000AA",
      ].includes(secret || "")
    )
      errors.push("TURNSTILE_SECRET_KEY must not be a test key");
    if (
      [
        "1x00000000000000000000AA",
        "2x00000000000000000000AB",
        "1x00000000000000000000BB",
        "2x00000000000000000000BB",
        "3x00000000000000000000FF",
      ].includes(siteKey || "")
    )
      errors.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY must not be a test key");
  }
  if (!isDurableMissedCallStoreConfigured())
    errors.push("MISSED_CALL_DURABLE_STORE");
  if (!process.env.DATABASE_URL?.trim()) errors.push("DATABASE_URL");
  return errors;
}
