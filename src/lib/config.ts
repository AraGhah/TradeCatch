/**
 * Production configuration guards.
 * In development, missing Turnstile/Resend is allowed (with warnings).
 * In production, both must be fully configured or book-audit rejects.
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

export function getProductionConfigErrors(): string[] {
  if (!isProductionRuntime()) return [];
  const errors: string[] = [];
  if (!isTurnstileConfigured()) {
    errors.push(
      "Turnstile is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY).",
    );
  }
  if (!isResendConfigured()) {
    errors.push(
      "Resend is not configured (RESEND_API_KEY + RESEND_FROM_EMAIL + RESEND_NOTIFY_EMAIL).",
    );
  }
  return errors;
}
