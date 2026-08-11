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

const moveSchema = z.object({
  cardId: z.string().min(1),
  stage: z.enum([
    "new",
    "contacted",
    "qualified",
    "quoted",
    "booked",
    "won",
    "lost",
  ]),
  estimatedValue: z.number().nonnegative().optional(),
  recordRevenue: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "ADVANCED_PIPELINE")) {
    return forbiddenFeatureResponse("ADVANCED_PIPELINE");
  }

  const cards = await getGrowthStore().listPipeline(auth.ctx.organization.id);
  return NextResponse.json({ ok: true, cards });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "ADVANCED_PIPELINE")) {
    return forbiddenFeatureResponse("ADVANCED_PIPELINE");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = moveSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid pipeline body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const card = await getGrowthServices().movePipeline({
    organizationId: auth.ctx.organization.id,
    cardId: parsed.data.cardId,
    stage: parsed.data.stage,
    estimatedValue: parsed.data.estimatedValue,
    recordRevenue: parsed.data.recordRevenue,
  });

  if (!card) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, card });
}
