import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlanId } from "@/product/saas/entitlements";
import { getBillingService } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: z.string(),
  interval: z.enum(["month", "year"]).default("month"),
  withTrial: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  successPath: z.string().optional(),
  cancelPath: z.string().optional(),
});

/** POST /api/businesses/:id/billing/checkout — Stripe Checkout session */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  if (!isPlanId(parsed.data.plan)) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const origin =
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  const successPath =
    parsed.data.successPath || `/app/billing?checkout=success`;
  const cancelPath = parsed.data.cancelPath || `/app/billing?checkout=cancel`;

  const email =
    access.ctx?.user.email ||
    `${access.organization.slug}@billing.tradecatch.local`;
  const name = access.ctx?.user.name || access.organization.name;

  const result = await getBillingService().createCheckout({
    businessId: id,
    organizationPlan: access.organization.plan,
    plan: parsed.data.plan,
    interval: parsed.data.interval,
    customerEmail: email,
    customerName: name,
    successUrl: `${origin}${successPath.startsWith("/") ? successPath : `/${successPath}`}`,
    cancelUrl: `${origin}${cancelPath.startsWith("/") ? cancelPath : `/${cancelPath}`}`,
    withTrial: parsed.data.withTrial,
    idempotencyKey: parsed.data.idempotencyKey,
    actorUserId: access.ctx?.user.id ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    sessionId: result.sessionId,
    url: result.url,
  });
}
