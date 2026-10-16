import { NextRequest, NextResponse } from "next/server";
import { getBillingStore, getSubscriptionService } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../billing/_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/subscription */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id);
  if (!access.ok) return access.response;

  const subscription =
    (await getBillingStore().getSubscription(id)) ??
    (await getSubscriptionService().getOrCreate(
      id,
      access.organization.plan,
    ));
  const entitlements = await getSubscriptionService().getEffective(
    id,
    access.organization.plan,
  );

  return NextResponse.json({
    ok: true,
    subscription,
    entitlements,
  });
}
