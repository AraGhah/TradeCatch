import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { requireTenantFeature } from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getGrowthStore } from "@/product/growth";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { saveOwnerSettings } from "@/product/receptionist/profile-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

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
  const c = await requireTenantFeature("MISSED_CALL_RECOVERY");
  if (!c.ok) return c.response;
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
  const c = await requireTenantFeature("MISSED_CALL_RECOVERY");
  if (!c.ok) return c.response;
  const { organization, membership, user } = c.ctx;

  let body: unknown;
  try {
    body = await readJsonBounded(request);
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
          title: "Receptionist settings updated",
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
