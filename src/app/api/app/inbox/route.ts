import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getStarterStore } from "@/product/starter/runtime";
import { getStarterServices } from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(["claim", "resolve", "takeover"]),
});

async function syncMissedCallInbox(
  organizationId: string,
  missedCallClientId: string | null,
) {
  if (!missedCallClientId) return;
  try {
    const { store } = await ensureMissedCallReady();
    const leads = await store.listLeads(missedCallClientId);
    const starter = getStarterStore();
    for (const lead of leads) {
      if (!lead.humanReviewRequired && lead.outcome !== "human_review") {
        continue;
      }
      await starter.upsertInboxItem({
        organizationId,
        kind: "missed_call",
        refId: lead.id,
        title: lead.customerName || lead.callerE164,
        reason: "Missed-call lead needs human review",
        status: "open",
      });
    }
  } catch (err) {
    console.warn("[inbox] missed-call sync skipped", err);
  }
}

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "HUMAN_TAKEOVER")) {
    return forbiddenFeatureResponse("HUMAN_TAKEOVER");
  }

  await syncMissedCallInbox(
    auth.ctx.organization.id,
    auth.ctx.organization.missedCallClientId,
  );

  const items = await getStarterStore().listInbox(auth.ctx.organization.id);
  return NextResponse.json({
    ok: true,
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      refId: i.refId,
      title: i.title,
      reason: i.reason,
      status: i.status,
      claimedByUserId: i.claimedByUserId,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "HUMAN_TAKEOVER")) {
    return forbiddenFeatureResponse("HUMAN_TAKEOVER");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getStarterStore();
  const orgId = auth.ctx.organization.id;
  const item = await store.getInboxItem(parsed.data.itemId, orgId);
  if (!item) {
    return NextResponse.json({ error: "Inbox item not found." }, { status: 404 });
  }

  if (parsed.data.action === "claim") {
    const next = await store.updateInboxItem(item.id, orgId, {
      status: "claimed",
      claimedByUserId: auth.ctx.user.id,
    });
    return NextResponse.json({ ok: true, item: next });
  }

  if (parsed.data.action === "resolve") {
    const next = await store.updateInboxItem(item.id, orgId, {
      status: "resolved",
    });
    if (item.kind === "website_lead") {
      await store.updateWebsiteLead(item.refId, orgId, {
        conversationMode: "resolved",
        status: "closed",
      });
    }
    if (item.kind === "quote") {
      await getStarterServices().stopQuote({
        organizationId: orgId,
        threadId: item.refId,
        reason: "manual_pause",
        status: "paused",
      });
    }
    return NextResponse.json({ ok: true, item: next });
  }

  // takeover — pause automations for website/quote refs
  if (item.kind === "missed_call") {
    const next = await store.updateInboxItem(item.id, orgId, {
      status: "claimed",
      claimedByUserId: auth.ctx.user.id,
      reason: "Human takeover (missed-call)",
    });
    return NextResponse.json({ ok: true, item: next });
  }

  await getStarterServices().setHumanTakeover({
    organizationId: orgId,
    kind: item.kind,
    refId: item.refId,
    title: item.title,
    reason: "Human takeover from inbox",
  });
  const next = await store.updateInboxItem(item.id, orgId, {
    status: "claimed",
    claimedByUserId: auth.ctx.user.id,
  });
  return NextResponse.json({ ok: true, item: next });
}
