import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBillingContext } from "@/product/saas/tenant";
import {
  listOverages,
  METERED_METRICS,
  resolveOverage,
} from "@/product/saas/usage-metering";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";
import { isCrossSiteMutation } from "@/lib/csrf";
import { recordSecurityEvent } from "@/product/security/hooks";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};
const fail = (code: string, status: number) =>
  NextResponse.json({ error: code }, { status, headers: privateHeaders });

const inputSchema = z
  .object({
    metric: z.enum(METERED_METRICS),
    decision: z.enum(["confirmed", "declined"]),
  })
  .strict();

/** Usage that has passed the written allowance this month, awaiting the owner. */
export async function GET() {
  const access = await requireBillingContext();
  if (!access.ok) return fail("forbidden", access.status);
  const overages = await listOverages(access.ctx.organization.id);
  return NextResponse.json({ ok: true, overages }, { headers: privateHeaders });
}

/**
 * The owner confirms (or declines) billing for usage past the allowance.
 * Nothing past the allowance is billable until this is confirmed.
 */
export async function POST(request: NextRequest) {
  if (
    isCrossSiteMutation({
      method: request.method,
      headers: request.headers,
      hosts: [request.nextUrl.host],
    })
  ) {
    return fail("forbidden", 403);
  }
  const access = await requireBillingContext();
  if (!access.ok) return fail("forbidden", access.status);

  let input: z.infer<typeof inputSchema>;
  try {
    const body = await readBodyText(request, 2048);
    const parsed = inputSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return fail("invalid_request", 400);
    input = parsed.data;
  } catch (cause) {
    return fail(
      "invalid_request",
      cause instanceof BodyTooLargeError ? 413 : 400,
    );
  }

  const resolved = await resolveOverage({
    organizationId: access.ctx.organization.id,
    metric: input.metric,
    decision: input.decision,
    userId: access.ctx.user.id,
  });
  // Nothing pending (never opened, or already answered): nothing changes.
  if (!resolved) return fail("not_pending", 409);

  await recordSecurityEvent({
    organizationId: access.ctx.organization.id,
    actorUserId: access.ctx.user.id,
    action:
      input.decision === "confirmed"
        ? "usage_overage_confirmed"
        : "usage_overage_declined",
    target: input.metric,
  });
  return NextResponse.json(
    { ok: true, overage: resolved },
    { headers: privateHeaders },
  );
}
