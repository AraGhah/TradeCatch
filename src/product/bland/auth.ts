/**
 * Credentials for the Bland adapter. Two separate secrets, neither of which
 * is the operations secret:
 *
 *   BLAND_TOOL_SECRET      sent by Bland's custom tools as `Authorization: Bearer ...`.
 *                          It can reach /api/bland/* and nothing else: not the
 *                          leads, escalations or cron endpoints the ops secret opens.
 *   BLAND_WEBHOOK_SECRET   Bland's webhook signing secret. It only verifies
 *                          the post-call webhook (HMAC-SHA256 of the raw body).
 *
 * Unlike the ops secret there is no "open when unset in development": an
 * endpoint that books appointments and texts callers is never anonymous. A
 * missing, short or reused secret answers 503 (fail closed), so a
 * misconfiguration is loud and cannot be mistaken for a working line.
 *
 * `BLAND_TOOL_SECRET_PREVIOUS` keeps the old secret valid while Bland's tool
 * definitions are updated, so rotation needs no downtime.
 */

import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/safe-compare";

/** 32 characters is 192 bits when generated (`openssl rand -base64 32`). */
export const MIN_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

export type BlandAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: "unauthorized" | "not_configured" };

/** Every secret this deployment holds. */
const SECRET_NAMES = [
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "AUTH_SECRET",
  "BLAND_TOOL_SECRET",
  "BLAND_TOOL_SECRET_PREVIOUS",
  "BLAND_WEBHOOK_SECRET",
] as const;

const TOOL_FAMILY: readonly string[] = ["BLAND_TOOL_SECRET", "BLAND_TOOL_SECRET_PREVIOUS"];
const WEBHOOK_FAMILY: readonly string[] = ["BLAND_WEBHOOK_SECRET"];

/**
 * A secret is usable when it is long enough and is not also another secret of
 * this deployment: reusing the ops, cron, session or webhook secret would
 * widen what a leaked Bland key can do (the tool secret and its rotation
 * predecessor may match each other).
 */
function usable(env: Env, name: string, family: readonly string[]): string | null {
  const value = env[name]?.trim();
  if (!value || value.length < MIN_SECRET_LENGTH) return null;
  for (const other of SECRET_NAMES) {
    if (family.includes(other)) continue;
    const candidate = env[other]?.trim();
    if (candidate && safeEqual(candidate, value)) return null;
  }
  return value;
}

/** The tool secrets that may currently authenticate (current first). Empty = not configured. */
export function blandToolSecrets(env: Env = process.env): string[] {
  const current = usable(env, "BLAND_TOOL_SECRET", TOOL_FAMILY);
  const previous = usable(env, "BLAND_TOOL_SECRET_PREVIOUS", TOOL_FAMILY);
  const out = [current, previous].filter((v): v is string => Boolean(v));
  // A previous secret identical to the current one adds nothing.
  return [...new Set(out)];
}

export function blandToolConfigured(env: Env = process.env): boolean {
  return blandToolSecrets(env).length > 0;
}

export function authorizeBlandTool(
  request: Request,
  env: Env = process.env,
): BlandAuthResult {
  const secrets = blandToolSecrets(env);
  if (secrets.length === 0) return { ok: false, status: 503, code: "not_configured" };
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer\s/i.test(header)) {
    return { ok: false, status: 401, code: "unauthorized" };
  }
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, code: "unauthorized" };
  // Check every accepted secret so timing does not reveal which one matched.
  let matched = false;
  for (const secret of secrets) if (safeEqual(token, secret)) matched = true;
  return matched ? { ok: true } : { ok: false, status: 401, code: "unauthorized" };
}

export function blandAuthResponse(result: Extract<BlandAuthResult, { ok: false }>): Response {
  return Response.json(
    {
      ok: false,
      error:
        result.code === "not_configured"
          ? "Bland integration is not configured."
          : "Unauthorized",
    },
    {
      status: result.status,
      headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" },
    },
  );
}

/**
 * Bland signs the exact body bytes: HMAC-SHA256, hex, in `X-Webhook-Signature`.
 * Verified over the raw text before anything is parsed.
 */
export function verifyBlandSignature(
  rawBody: string,
  signature: string | null,
  env: Env = process.env,
): "ok" | "bad_signature" | "not_configured" {
  const secret = usable(env, "BLAND_WEBHOOK_SECRET", WEBHOOK_FAMILY);
  if (!secret) return "not_configured";
  if (!signature) return "bad_signature";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.trim().toLowerCase().replace(/^sha256=/, "");
  return safeEqual(given, expected) ? "ok" : "bad_signature";
}
