import { NextRequest, NextResponse } from "next/server";
import { requireBillingContext } from "@/product/saas/tenant";
import {
  CheckoutError,
  createInstallationCheckoutSession,
} from "@/product/saas/stripe-checkout";
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
    { error: "Checkout could not be started. Please try again later.", code },
    { status, headers: privateHeaders },
  );

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
    scope: "installation-checkout",
    subject: access.ctx.organization.id + ":" + access.ctx.user.id,
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;
  try {
    const url = await createInstallationCheckoutSession(access.ctx.organization);
    await recordSecurityEvent({
      organizationId: access.ctx.organization.id,
      actorUserId: access.ctx.user.id,
      action: "installation_checkout_created",
      target: access.ctx.organization.id,
    });
    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ url }, { headers: privateHeaders });
    }
    return NextResponse.redirect(url, { status: 303, headers: privateHeaders });
  } catch (cause) {
    await recordSecurityEvent({
      organizationId: access.ctx.organization.id,
      actorUserId: access.ctx.user.id,
      action: "installation_checkout_failed",
      target: access.ctx.organization.id,
    });
    return error(
      cause instanceof CheckoutError ? cause.code : "unavailable",
      cause instanceof CheckoutError ? cause.status : 503,
    );
  }
}
