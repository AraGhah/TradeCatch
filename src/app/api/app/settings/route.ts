import { NextRequest, NextResponse } from "next/server";
import { orgSettingsSchema } from "@/product/starter/qualification";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthStore } from "@/product/growth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);

  const settings = await getGrowthStore().getOrgSettings(
    auth.ctx.organization.id,
  );
  return NextResponse.json({ ok: true, settings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = orgSettingsSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch = {
    ...(parsed.data.notifyEmail !== undefined
      ? {
          notifyEmail:
            parsed.data.notifyEmail === null
              ? undefined
              : parsed.data.notifyEmail,
        }
      : {}),
    ...(parsed.data.googleReviewUrl !== undefined
      ? {
          googleReviewUrl:
            parsed.data.googleReviewUrl === null
              ? undefined
              : parsed.data.googleReviewUrl,
        }
      : {}),
    ...(parsed.data.qualificationQuestions !== undefined
      ? { qualificationQuestions: parsed.data.qualificationQuestions }
      : {}),
    ...(parsed.data.onboardingCompletedAt !== undefined
      ? {
          onboardingCompletedAt:
            parsed.data.onboardingCompletedAt === null
              ? undefined
              : parsed.data.onboardingCompletedAt,
        }
      : {}),
    ...(parsed.data.localeDefault !== undefined
      ? { localeDefault: parsed.data.localeDefault }
      : {}),
  };

  const settings = await getGrowthStore().upsertOrgSettings(
    auth.ctx.organization.id,
    patch,
  );
  return NextResponse.json({ ok: true, settings });
}
