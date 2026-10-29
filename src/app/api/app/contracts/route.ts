import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthStore } from "@/product/growth";
import { getCrmRuntime } from "@/product/crm/runtime";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await requireTenantContext();
  if (!auth.ok) return { error: unauthorizedTenantResponse(auth.error) };
  if (!tenantHasFeature(auth.ctx, "CONTRACT_RENEWAL_AUTOMATION")) {
    return { error: forbiddenFeatureResponse("CONTRACT_RENEWAL_AUTOMATION") };
  }
  return { ctx: auth.ctx };
}

export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const contracts = await getGrowthStore().listServiceContracts(
    c.ctx.organization.id,
  );
  return NextResponse.json({ ok: true, contracts });
}

type CreateBody = {
  customerId?: unknown;
  title?: unknown;
  intervalDays?: unknown;
  nextRenewalAt?: unknown;
  reminderDaysBefore?: unknown;
  notes?: unknown;
};

export async function POST(request: NextRequest) {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization, membership } = c.ctx;

  const denied = forbiddenUnless(
    membership.role,
    "manage_settings",
    c.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.customerId !== "string" || !body.customerId) {
    return NextResponse.json(
      { error: "customerId is required." },
      { status: 400 },
    );
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  const intervalDays = Number(body.intervalDays);
  if (!Number.isFinite(intervalDays) || intervalDays < 1) {
    return NextResponse.json(
      { error: "intervalDays must be a positive number." },
      { status: 400 },
    );
  }
  const nextRenewalAt =
    typeof body.nextRenewalAt === "string"
      ? new Date(body.nextRenewalAt)
      : null;
  if (!nextRenewalAt || Number.isNaN(nextRenewalAt.getTime())) {
    return NextResponse.json(
      { error: "nextRenewalAt must be a valid date." },
      { status: 400 },
    );
  }
  const reminderDaysBefore =
    body.reminderDaysBefore === undefined
      ? 14
      : Number(body.reminderDaysBefore);
  if (!Number.isFinite(reminderDaysBefore) || reminderDaysBefore < 0) {
    return NextResponse.json(
      { error: "reminderDaysBefore must be a non-negative number." },
      { status: 400 },
    );
  }

  const customer = await getCrmRuntime().store.getCustomer(
    organization.id,
    body.customerId,
  );
  if (!customer) {
    return NextResponse.json(
      { error: "Unknown customer for this organization." },
      { status: 404 },
    );
  }

  const contract = await getGrowthStore().createServiceContract({
    organizationId: organization.id,
    customerId: customer.id,
    customerPhoneE164: customer.phoneE164,
    customerName:
      customer.displayName ||
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
      undefined,
    title: body.title.trim(),
    intervalDays,
    nextRenewalAt: nextRenewalAt.toISOString(),
    reminderDaysBefore,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });

  return NextResponse.json({ ok: true, contract }, { status: 201 });
}
