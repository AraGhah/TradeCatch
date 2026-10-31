import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  getProductionConfigErrors,
  isResendConfigured,
  requiresProductionLeadProtection,
} from "@/lib/config";
import { sendReferralSubmissionEmail } from "@/lib/email";
import { referralSubmissionSchema } from "@/lib/validation/referral-submission";

export const dynamic = "force-dynamic";

const SEND_ERROR =
  "We couldn't send your referral. Please try again or email us.";

const requestSchema = referralSubmissionSchema.safeExtend({
  idempotencyKey: z.string().uuid(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Public "refer a contractor" form. The submission is emailed to the team and
 * not stored (it holds a third party's contact details). Guards mirror
 * /api/book-audit: rate limit, bounded body, schema re-validation, honeypot
 * and Turnstile. A failed send is an error, never a silent success.
 */
export async function POST(request: NextRequest) {
  const configErrors = getProductionConfigErrors();
  if (configErrors.length > 0) {
    console.error(
      "[referrals] refusing request — production misconfigured:",
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
    key: `referral-submit:${ip}`,
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

  const parsed = requestSchema.safeParse(read.data);
  if (!parsed.success) {
    return jsonError("Invalid form data.", 400);
  }

  const {
    idempotencyKey,
    turnstileToken,
    companyWebsite,
    permissionConfirmed: _permissionConfirmed,
    ...details
  } = parsed.data;
  void _permissionConfirmed;

  if (companyWebsite) {
    console.warn("[referrals] honeypot triggered", { ip });
    return NextResponse.json({ ok: true });
  }

  const turnstile = await verifyTurnstileToken(turnstileToken, ip, "referral");
  if (
    !turnstile.success &&
    (turnstile.configured || requiresProductionLeadProtection())
  ) {
    console.warn("[referrals] Turnstile rejected", {
      ip,
      reason: turnstile.error,
    });
    return jsonError("Bot verification failed. Please try again.", 400);
  }

  const { sent } = await sendReferralSubmissionEmail(details, idempotencyKey);
  if (!sent) {
    // Local development without Resend can still exercise the form. Staging
    // and production builds never take this branch.
    if (!requiresProductionLeadProtection() && !isResendConfigured()) {
      console.info(
        "[referrals] email not configured here; accepted without delivery",
        { submission: idempotencyKey },
      );
      return NextResponse.json({ ok: true, delivered: false });
    }
    return jsonError(SEND_ERROR, 503);
  }

  console.info("[referrals] referral emailed", { submission: idempotencyKey });
  return NextResponse.json({ ok: true, delivered: true });
}
