import { NextRequest, NextResponse } from "next/server";
import { getOnboardingService } from "@/product/onboarding/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { authorizeOnboardingAccess } from "../_shared";

export const dynamic = "force-dynamic";

/** POST /api/businesses/:id/onboarding/activate */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;

  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const result = await getOnboardingService().activate({
    organization: org,
    actorUserId: access.ctx?.user.id ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, readiness: result.readiness },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    alreadyActive: result.alreadyActive,
    activatedAi: "activatedAi" in result ? result.activatedAi : false,
    readiness: result.readiness,
  });
}
