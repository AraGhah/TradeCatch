import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getBillingStore } from "@/product/billing/runtime";

export const dynamic = "force-dynamic";

/** GET /api/admin/billing/failures — failed webhooks + payment failures */
export async function GET(request: NextRequest) {
  const admin = await authorizeAdminRequest(request);
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status },
    );
  }

  const store = getBillingStore();
  const [failedWebhooks, subscriptions] = await Promise.all([
    store.listFailedWebhooks(),
    store.listSubscriptions(),
  ]);

  const paymentFailures = subscriptions.filter(
    (s) =>
      s.status === "past_due" ||
      s.status === "unpaid" ||
      s.status === "incomplete",
  );

  return NextResponse.json({
    ok: true,
    failedWebhooks,
    paymentFailures: paymentFailures.map((s) => ({
      businessId: s.businessId,
      status: s.status,
      plan: s.plan,
      gracePeriodEndsAt: s.gracePeriodEndsAt,
      latestInvoiceId: s.latestInvoiceId,
      stripeSubscriptionId: s.stripeSubscriptionId,
      updatedAt: s.updatedAt,
    })),
  });
}
