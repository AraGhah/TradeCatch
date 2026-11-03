import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  getProductionConfigErrors,
  requiresProductionLeadProtection,
} from "@/lib/config";
import { sendWebsiteRequestEmail } from "@/lib/email";
import { publicWebsiteRequestSchema } from "@/lib/validation/website-request";
import { requireTenantContext } from "@/product/saas/tenant";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Public "Get My Website Built" form. Guards mirror /api/referrals/submit:
 * production config check, rate limit, bounded body, schema re-validation,
 * honeypot and Turnstile.
 *
 * A request only ever records what the visitor asked for. It is not a purchase:
 * it adds nothing to a subscription and starts no billing. If the visitor is
 * signed in, the request is filed under their business so it shows in their
 * dashboard; otherwise it belongs to no tenant.
 */
export async function POST(request: NextRequest) {
  const configErrors = getProductionConfigErrors();
  if (configErrors.length > 0) {
    console.error(
      "[website-requests] refusing request — production misconfigured:",
      configErrors,
    );
    return jsonError(
      "This service is temporarily unavailable. Please try again later.",
      503,
    );
  }

  const ip = getClientIp(request);
  const unknownIp = ip === "unknown" || ip.startsWith("unknown:");

  const { allowed } = await rateLimitAsync({
    key: `website-request:${ip}`,
    limit: unknownIp ? 2 : 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return jsonError("Too many requests. Please try again later.", 429);
  }

  const read = await readJsonBody(request, 16_384);
  if (!read.ok) {
    return jsonError(
      read.status === 413 ? read.error : "Invalid request body.",
      read.status,
    );
  }

  const parsed = publicWebsiteRequestSchema.safeParse(read.data);
  if (!parsed.success) {
    return jsonError("Invalid form data.", 400);
  }
  const { turnstileToken, companyWebsite, idempotencyKey, ...details } =
    parsed.data;

  if (companyWebsite) {
    console.warn("[website-requests] honeypot triggered", { ip });
    return NextResponse.json({ ok: true });
  }

  const turnstile = await verifyTurnstileToken(
    turnstileToken,
    ip,
    "website-request",
  );
  if (
    !turnstile.success &&
    (turnstile.configured || requiresProductionLeadProtection())
  ) {
    console.warn("[website-requests] Turnstile rejected", {
      ip,
      reason: turnstile.error,
    });
    return jsonError("Bot verification failed. Please try again.", 400);
  }

  // Filing under the visitor's business is a convenience for customers; it
  // grants nothing, so a failure to resolve a session just means "public".
  let organizationId: string | null = null;
  let createdByUserId: string | undefined;
  try {
    const auth = await requireTenantContext();
    if (auth.ok) {
      organizationId = auth.ctx.organization.id;
      createdByUserId = auth.ctx.user.id;
    }
  } catch {
    organizationId = null;
  }

  try {
    const { created, request: saved } = await getWebsiteRequestService().submit(
      details,
      { organizationId, source: "pricing", idempotencyKey, createdByUserId },
    );
    if (created) {
      // The row is the record; the email only prompts the team to answer it.
      await sendWebsiteRequestEmail(saved, idempotencyKey);
    }
    console.info("[website-requests] request recorded", {
      request: saved.id,
      created,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[website-requests] could not store request", error);
    return jsonError(
      "We couldn't send your request. Please try again or email us.",
      503,
    );
  }
}
