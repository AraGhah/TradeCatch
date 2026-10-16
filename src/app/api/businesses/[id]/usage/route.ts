import { NextRequest, NextResponse } from "next/server";
import {
  getBillingStore,
  getSubscriptionService,
  getUsageService,
} from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../billing/_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/usage */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id);
  if (!access.ok) return access.response;

  const entitlements = await getSubscriptionService().getEffective(
    id,
    access.organization.plan,
  );
  const subscription = await getBillingStore().getSubscription(id);
  const usage = await getUsageService().getUsageSummary({
    businessId: id,
    plan: entitlements.plan,
    subscription,
  });

  return NextResponse.json({ ok: true, usage });
}
