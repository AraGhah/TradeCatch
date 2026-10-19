/**
 * The one place that decides which server secret signs sessions and seals
 * stored tokens. Kept free of framework imports so any runtime can use it.
 */

type EnvLike = Record<string, string | undefined>;

export function getAuthSecret(env: EnvLike = process.env): string | null {
  const secret =
    env.AUTH_SECRET?.trim() ||
    env.SESSION_SECRET?.trim() ||
    env.MISSED_CALL_OPS_SECRET?.trim() ||
    "";
  return secret || null;
}

/**
 * Secret for sealing stored credentials (MFA seeds, OAuth tokens).
 * A made-up development default is allowed only outside production; in
 * production a missing secret throws instead of silently using a value that
 * is public in the source code.
 */
export function requireSealingSecret(env: EnvLike = process.env): string {
  const secret = getAuthSecret(env);
  if (secret) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is not configured.");
  }
  return "tradecatch-dev-secret";
}

/** True when the signing secret is a dedicated, long-enough value (not an ops-secret fallback). */
export function authSecretStrength(env: EnvLike = process.env): "ok" | "missing" | "fallback" | "short" {
  const dedicated = env.AUTH_SECRET?.trim() || env.SESSION_SECRET?.trim() || "";
  if (!dedicated) return getAuthSecret(env) ? "fallback" : "missing";
  return dedicated.length >= 32 ? "ok" : "short";
}
