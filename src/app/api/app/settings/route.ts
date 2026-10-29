import { NextRequest, NextResponse } from "next/server";
import { orgSettingsSchema } from "@/product/starter/qualification";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
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
  const { getSecurityService } = await import("@/product/security/runtime");
  const { recordSecurityEvent } = await import("@/product/security/hooks");
  try {
    getSecurityService().assertPermission(
      auth.ctx.membership.role,
      "manage_ai",
      auth.ctx.isPlatformAdmin,
    );
  } catch {
    await recordSecurityEvent({
      organizationId: auth.ctx.organization.id,
      actorUserId: auth.ctx.user.id,
      action: "permission_denied",
      target: "settings",
    });
    return NextResponse.json(
      { error: "Insufficient permissions." },
      { status: 403 },
    );
  }

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

  // Setting a webhook is a Growth+ feature; clearing one stays allowed so a
  // downgraded organization can still remove its URL.
  if (
    typeof parsed.data.crmWebhookUrl === "string" &&
    !tenantHasFeature(auth.ctx, "CRM_INTEGRATION_LIMITED")
  ) {
    return forbiddenFeatureResponse("CRM_INTEGRATION_LIMITED");
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
    ...(parsed.data.crmWebhookUrl !== undefined
      ? {
          crmWebhookUrl:
            parsed.data.crmWebhookUrl === null
              ? undefined
              : parsed.data.crmWebhookUrl,
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
