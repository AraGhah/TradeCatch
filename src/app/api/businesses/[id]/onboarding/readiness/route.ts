import { NextRequest, NextResponse } from "next/server";
import { getOnboardingService } from "@/product/onboarding/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { authorizeOnboardingAccess } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/onboarding/readiness */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id);
  if (!access.ok) return access.response;

  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const readiness = await getOnboardingService().computeReadiness(org);
  return NextResponse.json({ ok: true, readiness });
}
