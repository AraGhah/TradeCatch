import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthStore } from "@/product/growth";
import { checkOutboundUrl } from "@/lib/safe-url";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await requireTenantContext();
  if (!auth.ok) return { error: unauthorizedTenantResponse(auth.error) };
  if (!tenantHasFeature(auth.ctx, "CRM_INTEGRATION_ADVANCED")) {
    return { error: forbiddenFeatureResponse("CRM_INTEGRATION_ADVANCED") };
  }
  return { ctx: auth.ctx };
}

export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const endpoints = await getGrowthStore().listCrmWebhookEndpoints(
    c.ctx.organization.id,
  );
  return NextResponse.json({ ok: true, endpoints });
}

type CreateBody = {
  url?: unknown;
  label?: unknown;
  eventTypes?: unknown;
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

  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url is required." }, { status: 400 });
  }
  const checked = checkOutboundUrl(body.url.trim());
  if (!checked.ok) {
    return NextResponse.json(
      { error: "url must be a valid, public https:// URL." },
      { status: 400 },
    );
  }
  if (typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "label is required." }, { status: 400 });
  }
  let eventTypes: string[] = [];
  if (body.eventTypes !== undefined) {
    if (
      !Array.isArray(body.eventTypes) ||
      !body.eventTypes.every((t) => typeof t === "string")
    ) {
      return NextResponse.json(
        { error: "eventTypes must be an array of strings." },
        { status: 400 },
      );
    }
    eventTypes = body.eventTypes;
  }

  const existing = await getGrowthStore().listCrmWebhookEndpoints(
    organization.id,
  );
  const MAX_ENDPOINTS = 10;
  if (existing.length >= MAX_ENDPOINTS) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_ENDPOINTS} webhook endpoints is allowed.` },
      { status: 400 },
    );
  }

  const endpoint = await getGrowthStore().createCrmWebhookEndpoint({
    organizationId: organization.id,
    url: checked.url.toString(),
    label: body.label.trim(),
    eventTypes,
  });

  return NextResponse.json({ ok: true, endpoint }, { status: 201 });
}
