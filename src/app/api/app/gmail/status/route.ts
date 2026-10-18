import { NextResponse } from "next/server";
import { getGmailStatus } from "@/product/gmail/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const status = await getGmailStatus(auth.ctx.organization.id, auth.ctx.user.id);
  return NextResponse.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
}
