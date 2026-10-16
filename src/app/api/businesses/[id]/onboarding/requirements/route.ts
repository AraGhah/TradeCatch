import { NextRequest, NextResponse } from "next/server";
import { requirementsForPlan } from "@/product/onboarding/requirements";
import { authorizeOnboardingAccess } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/onboarding/requirements */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id);
  if (!access.ok) return access.response;

  return NextResponse.json({
    ok: true,
    plan: access.organization.plan,
    requirements: requirementsForPlan(access.organization.plan),
  });
}
