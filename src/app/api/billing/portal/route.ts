import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBillingContext } from "@/product/saas/tenant";
import {
  BillingPortalError,
  createStripePortalSession,
} from "@/product/saas/stripe-portal";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";
import { isCrossSiteMutation } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { recordSecurityEvent } from "@/product/security/hooks";

export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};
const error = (code: string, status: number) =>
  NextResponse.json(
    { error: "Billing could not be opened. Please try again later.", code },
    { status, headers: privateHeaders },
  );
const inputSchema = z
  .object({ locale: z.enum(["en", "fr"]).optional() })
  .strict();

export async function POST(request: NextRequest) {
  if (
    isCrossSiteMutation({
      method: request.method,
      headers: request.headers,
      hosts: [request.nextUrl.host],
    })
  ) {
    return error("forbidden", 403);
  }
  const access = await requireBillingContext();
  if (!access.ok) return error("forbidden", access.status);
  const limited = await enforceRateLimit({
    scope: "billing-portal",
    subject: access.ctx.organization.id + ":" + access.ctx.user.id,
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;
  let input;
  try {
    const body = await readBodyText(request, 2048);
    const type = request.headers.get("content-type")?.split(";")[0].trim();
    const value =
      type === "application/json"
        ? JSON.parse(body)
        : type === "application/x-www-form-urlencoded"
          ? Object.fromEntries(new URLSearchParams(body))
          : null;
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) return error("invalid_request", 400);
    input = parsed.data;
  } catch (cause) {
    return error(
      "invalid_request",
      cause instanceof BodyTooLargeError ? 413 : 400,
    );
  }
  try {
    const url = await createStripePortalSession(
      access.ctx.organization,
      input.locale || access.ctx.user.locale,
    );
    await recordSecurityEvent({
      organizationId: access.ctx.organization.id,
      actorUserId: access.ctx.user.id,
      action: "billing_portal_created",
      target: access.ctx.organization.id,
    });
    // JSON clients navigate only after a confirmed server-created session.
    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ url }, { headers: privateHeaders });
    }
    return NextResponse.redirect(url, { status: 303, headers: privateHeaders });
  } catch (cause) {
    await recordSecurityEvent({
      organizationId: access.ctx.organization.id,
      actorUserId: access.ctx.user.id,
      action: "billing_portal_failed",
      target: access.ctx.organization.id,
    });
    return error(
      cause instanceof BillingPortalError ? cause.code : "unavailable",
      cause instanceof BillingPortalError ? cause.status : 503,
    );
  }
}
