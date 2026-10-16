import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getBillingService } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  returnPath: z.string().optional(),
});

/** POST /api/businesses/:id/billing/portal — Stripe Customer Portal */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id, { manage: true });
  if (!access.ok) return access.response;

  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const parsed = bodySchema.safeParse(json);
  const returnPath = parsed.success
    ? parsed.data.returnPath || "/app/billing"
    : "/app/billing";

  const origin =
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  const result = await getBillingService().createPortal({
    businessId: id,
    returnUrl: `${origin}${returnPath.startsWith("/") ? returnPath : `/${returnPath}`}`,
    actorUserId: access.ctx?.user.id ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, url: result.url });
}
