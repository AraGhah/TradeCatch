import { sharedRateLimitConfigured } from "./rate-limit";
import { authSecretStrength } from "@/product/saas/auth/secret";

export type SecurityWarning = { key: string; message: string };

type Env = Record<string, string | undefined>;

/**
 * Settings that leave the live deployment working but weaker than intended.
 *
 * These are reported next to the production-safety flags but do not fail
 * readiness: turning a deploy into an outage over a short secret would be a
 * change of behavior, so an operator sees them and decides. Keys and
 * explanations only; no value is ever included.
 */
export function getSecurityWarnings(env: Env = process.env): SecurityWarning[] {
  const warnings: SecurityWarning[] = [];

  const secret = authSecretStrength(env);
  if (secret === "missing") {
    warnings.push({
      key: "AUTH_SECRET",
      message: "is not set, so sessions cannot be signed",
    });
  } else if (secret === "fallback") {
    warnings.push({
      key: "AUTH_SECRET",
      message:
        "is not set; sessions and sealed tokens reuse the operations secret, so leaking one exposes both",
    });
  } else if (secret === "short") {
    warnings.push({
      key: "AUTH_SECRET",
      message: "is shorter than 32 characters",
    });
  }

  const onVercel = env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
  const clientIpTrusted =
    onVercel ||
    env.CF_TRUSTED === "1" ||
    env.CF_CONNECTING_IP_TRUSTED === "1" ||
    env.TRUST_PROXY_HEADERS === "1";
  if (!clientIpTrusted) {
    warnings.push({
      key: "CF_TRUSTED",
      message:
        "is not set, so every visitor shares one rate-limit bucket named unknown; set it to 1 once the origin is reachable only through Cloudflare",
    });
  }

  if (!sharedRateLimitConfigured(env)) {
    warnings.push({
      key: "RATE_LIMIT_STORE",
      message:
        "has no shared store (Upstash, or DATABASE_URL with the durable store on), so limits apply per instance",
    });
  }

  return warnings;
}
