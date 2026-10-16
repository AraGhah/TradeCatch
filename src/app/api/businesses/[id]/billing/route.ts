import { NextRequest, NextResponse } from "next/server";
import { getBillingService } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "./_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/billing — billing summary */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id);
  if (!access.ok) return access.response;

  const summary = await getBillingService().getSummary({
    businessId: id,
    organizationPlan: access.organization.plan,
  });

  return NextResponse.json({
    ok: true,
    ...summary,
    canManage: access.canManage,
  });
}
