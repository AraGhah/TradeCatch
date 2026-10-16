import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlanId } from "@/product/saas/entitlements";
import { getBillingService } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: z.string(),
  interval: z.enum(["month", "year"]).optional(),
});

/** POST /api/businesses/:id/billing/trial — start free trial (no card yet) */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success || !isPlanId(parsed.data.plan)) {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }

  const result = await getBillingService().startTrial({
    businessId: id,
    plan: parsed.data.plan,
    interval: parsed.data.interval,
    actorUserId: access.ctx?.user.id ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, subscription: result.subscription });
}
