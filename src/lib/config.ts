/**
 * Production configuration guards.
 * Missing Turnstile/Resend is allowed in every environment (with warnings) so
 * book-audit keeps accepting leads while those services are being set up —
 * see getProductionConfigErrors below for the (now-empty) hard-block list.
 */

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isTurnstileConfigured(): boolean {
  return Boolean(
    process.env.TURNSTILE_SECRET_KEY &&
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  );
}

export function isResendConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.RESEND_FROM_EMAIL &&
    process.env.RESEND_NOTIFY_EMAIL,
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
  return (
    env.TRADECATCH_E2E === "1" && env.VERCEL_ENV?.toLowerCase() !== "production"
  );
}

/**
 * Intentionally always empty: book-audit no longer refuses submissions when
 * Turnstile/Resend are unconfigured. Kept as a call site so a future hard
 * requirement (if ever needed) has an obvious place to live.
 */
export function getProductionConfigErrors(): string[] {
  return [];
}
