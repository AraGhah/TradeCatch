import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOnboardingService } from "@/product/onboarding/runtime";
import { authorizeOnboardingAccess } from "./_shared";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/onboarding */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id);
  if (!access.ok) return access.response;

  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const snapshot = await getOnboardingService().getSnapshot(org);
  return NextResponse.json({ ok: true, ...snapshot, canManage: access.canManage });
}

const stepEnum = z.enum([
  "account",
  "business",
  "ai_receptionist",
  "phone",
  "calendar",
  "automations",
  "activation",
]);

const patchSchema = z.object({
  stepId: stepEnum,
  payload: z.record(z.string(), z.unknown()).default({}),
  skip: z.boolean().optional(),
  currentStep: stepEnum.optional(),
});

/** PATCH /api/businesses/:id/onboarding — save a setup step */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeOnboardingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const result = await getOnboardingService().saveStep({
    organization: org,
    stepId: parsed.data.stepId,
    payload: parsed.data.payload,
    skip: parsed.data.skip,
    actorUserId: access.ctx?.user.id ?? null,
  });

  if ("ok" in result && result.ok === false) {
    return NextResponse.json(
      { error: result.error, ...result.snapshot },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    ...("snapshot" in result ? result.snapshot : result),
  });
}
