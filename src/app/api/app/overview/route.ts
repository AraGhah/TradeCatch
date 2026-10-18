import { NextRequest, NextResponse } from "next/server";
import { loadDashboardOverview } from "@/product/saas/dashboard-load";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  const url = new URL(request.url);
  try {
    const overview = await loadDashboardOverview({
      organization: auth.ctx.organization,
      userId: auth.ctx.user.id,
      range: url.searchParams.get("range"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return NextResponse.json({ ok: true, overview });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
