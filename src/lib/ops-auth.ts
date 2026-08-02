import { timingSafeEqual } from "node:crypto";

/**
 * Shared bearer auth for Module A ops endpoints (leads, escalations, sandbox).
 *
 * Accepts `MISSED_CALL_OPS_SECRET` or, as a fallback, `CRON_SECRET`
 * (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
 *
 * Production: deny if no secret is configured or the bearer token mismatches.
 * Development: allow unauthenticated access when no secret is set (local DX);
 * if a secret is set, it is enforced.
 */
export function getOpsSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret =
    env.MISSED_CALL_OPS_SECRET?.trim() || env.CRON_SECRET?.trim() || "";
  return secret || null;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

function safeEqualString(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function authorizeOpsRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const secret = getOpsSecret(env);
  if (!secret) {
    return !isProduction(env);
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return false;
  return safeEqualString(token, secret);
}

/**
 * Structured ops access audit. Bearer auth remains shared-secret based until
 * real RBAC ships; require `X-Ops-Actor` in production so PII access is
 * attributable in logs.
 */
export function logOpsAccess(
  request: Request,
  action: string,
  detail?: Record<string, unknown>,
): { actor: string; ok: boolean; missingActor: boolean } {
  const actor =
    request.headers.get("x-ops-actor")?.trim() ||
    request.headers.get("x-vercel-cron")?.trim() ||
    "";
  const missingActor =
    isProduction(process.env) &&
    !actor &&
    !request.headers.get("x-vercel-cron");
  const entry = {
    at: new Date().toISOString(),
    action,
    actor: actor || "anonymous",
    path: new URL(request.url).pathname,
    ...detail,
  };
  if (missingActor) {
    console.warn(
      "[ops-audit] missing X-Ops-Actor on production request",
      entry,
    );
  } else {
    console.info("[ops-audit]", entry);
  }
  return { actor: entry.actor, ok: !missingActor, missingActor };
}

export function unauthorizedOpsResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function missingOpsActorResponse() {
  return Response.json(
    {
      error:
        "Missing X-Ops-Actor header. Identify the operator for PII access audit.",
    },
    { status: 403 },
  );
}
