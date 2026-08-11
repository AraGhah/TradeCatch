import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthServices, getGrowthStore } from "@/product/growth";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  action: z.literal("complete"),
  appointmentId: z.string().min(1),
});

const setUrlSchema = z.object({
  action: z.literal("set-url"),
  googleReviewUrl: z.string().url(),
});

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "REVIEW_AUTOMATION")) {
    return forbiddenFeatureResponse("REVIEW_AUTOMATION");
  }

  const store = getGrowthStore();
  const orgId = auth.ctx.organization.id;
  const [reviews, settings] = await Promise.all([
    store.listReviewRequests(orgId),
    store.getOrgSettings(orgId),
  ]);

  return NextResponse.json({
    ok: true,
    reviews,
    googleReviewUrl: settings.googleReviewUrl ?? null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "REVIEW_AUTOMATION")) {
    return forbiddenFeatureResponse("REVIEW_AUTOMATION");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const action =
    typeof json === "object" && json && "action" in json
      ? String((json as { action?: string }).action)
      : "";

  const orgId = auth.ctx.organization.id;

  if (action === "complete") {
    const parsed = completeSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid complete body.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const appointment =
      await getGrowthServices().completeAppointmentAndMaybeReview({
        organizationId: orgId,
        appointmentId: parsed.data.appointmentId,
      });
    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, appointment });
  }

  if (action === "set-url") {
    const parsed = setUrlSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid set-url body.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const settings = await getGrowthStore().upsertOrgSettings(orgId, {
      googleReviewUrl: parsed.data.googleReviewUrl,
    });
    return NextResponse.json({
      ok: true,
      googleReviewUrl: settings.googleReviewUrl ?? null,
    });
  }

  return NextResponse.json(
    { error: 'action must be "complete" or "set-url".' },
    { status: 400 },
  );
}
