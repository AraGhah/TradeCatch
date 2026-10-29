import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { saveSmsReceptionistSettings } from "@/product/missed-call/owner-settings";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await requireTenantContext();
  if (!auth.ok) return { error: unauthorizedTenantResponse(auth.error) };
  if (!tenantHasFeature(auth.ctx, "MISSED_CALL_RECOVERY")) {
    return { error: forbiddenFeatureResponse("MISSED_CALL_RECOVERY") };
  }
  return { ctx: auth.ctx };
}

/** Current SMS receptionist business details, hours, and roster, if linked. */
export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization } = c.ctx;

  if (!organization.missedCallClientId) {
    return NextResponse.json({ ok: true, linked: false });
  }
  const { store } = await ensureMissedCallReady();
  const client = await store.getClient(organization.missedCallClientId);
  if (!client) {
    return NextResponse.json({ ok: true, linked: false });
  }
  return NextResponse.json({
    ok: true,
    linked: true,
    // The receiving number is ops-assigned and never editable here.
    smsFromNumber: client.smsFromNumber,
    contractorDisplayName: client.contractorDisplayName,
    timezone: client.timezone,
    businessHours: client.businessHours,
    technicianRoster: client.technicianRoster,
    humanReviewPhone: client.humanReviewPhone ?? null,
  });
}

/** Owner / admin saves business details, hours, and technician roster. */
export async function PUT(request: NextRequest) {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization, membership } = c.ctx;

  const denied = forbiddenUnless(
    membership.role,
    "manage_settings",
    c.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { store } = await ensureMissedCallReady();
  const result = await saveSmsReceptionistSettings(
    {
      getClient: (id) => store.getClient(id),
      saveClient: (client) => store.saveClient(client),
    },
    { organization, role: membership.role, body },
  );
  return NextResponse.json(result.body, { status: result.status });
}
