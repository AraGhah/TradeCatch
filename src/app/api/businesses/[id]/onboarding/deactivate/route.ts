import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOnboardingService } from "@/product/onboarding/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { authorizeOnboardingAccess } from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().max(400).optional(),
});

/** POST /api/businesses/:id/onboarding/deactivate */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;

  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const parsed = bodySchema.safeParse(json);

  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const result = await getOnboardingService().deactivate({
    organization: org,
    actorUserId: access.ctx?.user.id ?? null,
    reason: parsed.success ? parsed.data.reason : undefined,
  });

  return NextResponse.json({ ok: true, readiness: result.readiness });
}
