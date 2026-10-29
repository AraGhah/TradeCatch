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

type PatchBody = {
  url?: unknown;
  label?: unknown;
  eventTypes?: unknown;
  active?: unknown;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization, membership } = c.ctx;

  const denied = forbiddenUnless(
    membership.role,
    "manage_settings",
    c.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const patch: {
    url?: string;
    label?: string;
    eventTypes?: string[];
    active?: boolean;
  } = {};

  if (body.url !== undefined) {
    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "Invalid url." }, { status: 400 });
    }
    const checked = checkOutboundUrl(body.url.trim());
    if (!checked.ok) {
      return NextResponse.json(
        { error: "url must be a valid, public https:// URL." },
        { status: 400 },
      );
    }
    patch.url = checked.url.toString();
  }
  if (body.label !== undefined) {
    if (typeof body.label !== "string" || !body.label.trim()) {
      return NextResponse.json({ error: "Invalid label." }, { status: 400 });
    }
    patch.label = body.label.trim();
  }
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
    patch.eventTypes = body.eventTypes;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Invalid active." }, { status: 400 });
    }
    patch.active = body.active;
  }

  const updated = await getGrowthStore().updateCrmWebhookEndpoint(
    id,
    organization.id,
    patch,
  );
  if (!updated) {
    return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, endpoint: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization, membership } = c.ctx;

  const denied = forbiddenUnless(
    membership.role,
    "manage_settings",
    c.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  const { id } = await params;
  const removed = await getGrowthStore().deleteCrmWebhookEndpoint(
    id,
    organization.id,
  );
  if (!removed) {
    return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
