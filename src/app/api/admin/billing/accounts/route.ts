import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getBillingStore } from "@/product/billing/runtime";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

/** GET /api/admin/billing/accounts — admin billing overview */
export async function GET(request: NextRequest) {
  const admin = await authorizeAdminRequest(request);
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status },
    );
  }

  const subscriptions = await getBillingStore().listSubscriptions();
  const saas = getSaasStore();
  const accounts = [];
  for (const sub of subscriptions) {
    const org = await saas.getOrganization(sub.businessId);
    accounts.push({
      businessId: sub.businessId,
      businessName: org?.name ?? null,
      accountType: org?.accountType ?? null,
      organizationPlan: org?.plan ?? null,
      subscription: {
        plan: sub.plan,
        status: sub.status,
        billingInterval: sub.billingInterval,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        gracePeriodEndsAt: sub.gracePeriodEndsAt,
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        outstandingBalanceCents: sub.outstandingBalanceCents,
      },
    });
  }

  return NextResponse.json({ ok: true, accounts });
}
