import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getStarterStore } from "@/product/starter/runtime";
import { getStarterServices, looksLikeE164 } from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

const ingestSchema = z.object({
  customerPhoneE164: z.string().trim().min(8).max(32),
  customerName: z.string().trim().max(120).optional(),
  quoteRef: z.string().trim().max(80).optional(),
  quoteAmount: z.number().nonnegative().optional(),
  locale: z.enum(["en", "fr"]).optional(),
  quoteSentAt: z.string().datetime().optional(),
});

const stopSchema = z.object({
  threadId: z.string().min(1),
  reason: z.enum([
    "won",
    "lost",
    "manual_pause",
    "human_takeover",
    "opt_out",
    "customer_reply",
    "sequence_complete",
  ]),
  status: z.enum(["stopped", "won", "lost", "paused"]).optional(),
});

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "QUOTE_FOLLOW_UP")) {
    return forbiddenFeatureResponse("QUOTE_FOLLOW_UP");
  }

  const threads = await getStarterStore().listQuoteThreads(
    auth.ctx.organization.id,
  );
  return NextResponse.json({
    ok: true,
    quotes: threads.map((t) => ({
      id: t.id,
      customerPhoneE164: t.customerPhoneE164,
      customerName: t.customerName,
      quoteRef: t.quoteRef,
      quoteAmount: t.quoteAmount,
      status: t.status,
      stopReason: t.stopReason,
      conversationMode: t.conversationMode,
      nextStepIndex: t.nextStepIndex,
      nextRunAt: t.nextRunAt,
      attempts: t.attempts,
      locale: t.locale,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "QUOTE_FOLLOW_UP")) {
    return forbiddenFeatureResponse("QUOTE_FOLLOW_UP");
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
      : "ingest";

  const services = getStarterServices();
  const orgId = auth.ctx.organization.id;

  if (action === "stop") {
    const parsed = stopSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid stop body.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const thread = await services.stopQuote({
      organizationId: orgId,
      threadId: parsed.data.threadId,
      reason: parsed.data.reason,
      status: parsed.data.status,
    });
    if (!thread) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, quote: thread });
  }

  const parsed = ingestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ingest body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let phone = parsed.data.customerPhoneE164.trim();
  if (!phone.startsWith("+")) phone = `+${phone.replace(/\D/g, "")}`;
  if (!looksLikeE164(phone)) {
    return NextResponse.json(
      { error: "customerPhoneE164 must be E.164." },
      { status: 400 },
    );
  }

  const thread = await services.ingestQuote({
    organizationId: orgId,
    clientAccountId: auth.ctx.organization.missedCallClientId ?? undefined,
    customerPhoneE164: phone,
    customerName: parsed.data.customerName,
    quoteRef: parsed.data.quoteRef,
    quoteAmount: parsed.data.quoteAmount,
    locale: parsed.data.locale,
    quoteSentAt: parsed.data.quoteSentAt,
  });

  return NextResponse.json({ ok: true, quote: thread });
}
