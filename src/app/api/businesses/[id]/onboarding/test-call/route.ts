import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOnboardingService } from "@/product/onboarding/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { authorizeOnboardingAccess } from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z
    .enum(["simulation", "live_instructions", "confirm_live"])
    .default("simulation"),
});

/** POST /api/businesses/:id/onboarding/test-call */
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
  const mode = parsed.success ? parsed.data.mode : "simulation";

  const org =
    (await getSaasStore().getOrganization(id)) ?? access.organization;
  const result = await getOnboardingService().verify({
    organization: org,
    kind: "test_call",
    mode,
    actorUserId: access.ctx?.user.id ?? null,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      error: result.error,
      detail: result.detail,
      readiness: result.readiness,
    },
    { status: result.ok ? 200 : 422 },
  );
}
