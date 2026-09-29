import { NextRequest, NextResponse } from "next/server";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getGrowthStore } from "@/product/growth";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { saveOwnerSettings } from "@/product/receptionist/profile-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await requireTenantContext();
  if (!auth.ok) return { error: unauthorizedTenantResponse(auth.error) };
  if (!tenantHasFeature(auth.ctx, "MISSED_CALL_RECOVERY")) {
    return { error: forbiddenFeatureResponse("MISSED_CALL_RECOVERY") };
  }
  return { ctx: auth.ctx };
}

async function getClient(clientId: string) {
  try {
    const { store } = await ensureMissedCallReady();
    return await store.getClient(clientId);
  } catch {
    return null;
  }
}

/** Current profile + what the receptionist falls back to when a field is blank. */
export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization } = c.ctx;

  const profile = await getReceptionistRuntime().profileStore.getProfile(
    organization.id,
  );
  const client = organization.missedCallClientId
    ? await getClient(organization.missedCallClientId)
    : null;
  return NextResponse.json({
    ok: true,
    linked: Boolean(client),
    activated: profile?.activated ?? false,
    phoneNumberE164: profile?.phoneNumberE164 ?? null,
    settings: profile?.settings ?? defaultProfileSettings(),
    updatedAt: profile?.updatedAt ?? null,
    defaults: client
      ? {
          businessName: client.contractorDisplayName,
          timezone: client.timezone,
          businessHours: client.businessHours,
        }
      : null,
  });
}

/** Owner / admin saves content settings. Number + activation stay with ops. */
export async function PUT(request: NextRequest) {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization, membership, user } = c.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  const result = await saveOwnerSettings(
    {
      profiles: runtime.profileStore,
      getClient,
      refresh: (force) => runtime.refresh(force),
      addTimeline: ({ organizationId, actor, at }) =>
        getGrowthStore().addTimelineEvent({
          organizationId,
          kind: "receptionist_settings",
          title: "AI receptionist settings updated",
          actor,
          at,
        }),
    },
    {
      organization,
      role: membership.role,
      userEmail: user.email,
      body,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
