import { NextRequest, NextResponse } from "next/server";
import { getOnboardingService } from "@/product/onboarding/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { authorizeOnboardingAccess } from "../_shared";

export const dynamic = "force-dynamic";

/** POST /api/businesses/:id/onboarding/verify-phone */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;
  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const result = await getOnboardingService().verify({
    organization: org,
    kind: "phone",
    actorUserId: access.ctx?.user.id ?? null,
  });
  return NextResponse.json(
    { ok: result.ok, error: result.error, detail: result.detail, readiness: result.readiness },
    { status: result.ok ? 200 : 422 },
  );
}
