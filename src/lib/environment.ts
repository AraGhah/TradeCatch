/**
 * TradeCatch deployment environment helpers.
 *
 * - production: live customers, real Twilio, production Postgres
 * - staging: isolated demo/test stack (separate Worker + DB + secrets)
 * - development: local `next dev` / unit tests
 *
 * Prefer an explicit TRADECATCH_ENV. NEXT_PUBLIC_TRADECATCH_ENV mirrors it for
 * client UI (banner). NEXT_PUBLIC_DEMO_MODE=1 forces the Demo Mode indicator.
 */

export type TradeCatchEnvironment = "production" | "staging" | "development";

type RuntimeEnvironment = Record<string, string | undefined>;

function normalizeEnvName(
  raw: string | undefined,
): TradeCatchEnvironment | null {
  const value = raw?.trim().toLowerCase();
  if (value === "production" || value === "prod") return "production";
  if (value === "staging" || value === "stage" || value === "demo") {
    return "staging";
  }
  if (value === "development" || value === "dev" || value === "test") {
    return "development";
  }
  return null;
}

function hostnameLooksLikeStaging(siteUrl: string | undefined): boolean {
  if (!siteUrl?.trim()) return false;
  try {
    const host = new URL(siteUrl).hostname.toLowerCase();
    return (
      host.startsWith("staging.") ||
      host.startsWith("demo.") ||
      host.includes(".staging.") ||
      host.endsWith("-staging.workers.dev") ||
      host.includes("tradecatch-staging")
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the logical TradeCatch environment.
 * Explicit TRADECATCH_ENV / NEXT_PUBLIC_TRADECATCH_ENV win; otherwise infer from
 * site URL hostname or NODE_ENV.
 */
export function resolveTradeCatchEnv(
  env: RuntimeEnvironment = process.env,
): TradeCatchEnvironment {
  const explicit =
    normalizeEnvName(env.TRADECATCH_ENV) ||
    normalizeEnvName(env.NEXT_PUBLIC_TRADECATCH_ENV);
  if (explicit) return explicit;

  if (hostnameLooksLikeStaging(env.NEXT_PUBLIC_SITE_URL)) {
    return "staging";
  }

  return env.NODE_ENV === "production" ? "production" : "development";
}

export function isStagingRuntime(
  env: RuntimeEnvironment = process.env,
): boolean {
  return resolveTradeCatchEnv(env) === "staging";
}

/**
 * True only for the live customer deployment. Staging builds often use
 * NODE_ENV=production for fail-closed behaviour, but must not be treated as
 * the public production host.
 */
export function isRealProductionRuntime(
  env: RuntimeEnvironment = process.env,
): boolean {
  return (
    env.NODE_ENV === "production" && resolveTradeCatchEnv(env) === "production"
  );
}

/** Visible Demo Mode / Staging chrome (banner, noindex, health label). */
export function isDemoModeVisible(
  env: RuntimeEnvironment = process.env,
): boolean {
  if (env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1") return true;
  return isStagingRuntime(env);
}

/**
 * Ops sandbox endpoints (missed-call / receptionist) may run without Twilio.
 * Enabled in development, explicit MISSED_CALL_SANDBOX=1, or staging.
 * Never auto-enabled on real production.
 */
export function isOpsSandboxEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  if (isRealProductionRuntime(env)) {
    return env.MISSED_CALL_SANDBOX?.trim() === "1";
  }
  return (
    env.MISSED_CALL_SANDBOX?.trim() === "1" ||
    env.NODE_ENV !== "production" ||
    isStagingRuntime(env)
  );
}

/**
 * Staging should simulate outbound SMS unless an operator explicitly opts into
 * a dedicated staging Twilio number with MISSED_CALL_SMS_MODE=live.
 * Live production never uses the dry-run adapter (missing Twilio fails closed).
 */
export function shouldUseDryRunSms(
  env: RuntimeEnvironment = process.env,
): boolean {
  if (isRealProductionRuntime(env)) return false;
  const mode = env.MISSED_CALL_SMS_MODE?.trim().toLowerCase();
  if (mode === "dry-run") return true;
  if (mode === "live") return false;
  // Staging defaults to dry-run; local/dev also dry-runs when unset.
  return isStagingRuntime(env) || env.NODE_ENV !== "production";
}

/** Staging gate credentials are configured (HTTP Basic). */
export function isStagingAccessConfigured(
  env: RuntimeEnvironment = process.env,
): boolean {
  return Boolean(
    env.STAGING_BASIC_AUTH_USER?.trim() &&
    env.STAGING_BASIC_AUTH_PASSWORD?.trim(),
  );
}

export function getEnvironmentPublicLabel(
  env: RuntimeEnvironment = process.env,
): string {
  const resolved = resolveTradeCatchEnv(env);
  if (resolved === "staging" || env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1") {
    return "Demo Mode";
  }
  return resolved;
}
