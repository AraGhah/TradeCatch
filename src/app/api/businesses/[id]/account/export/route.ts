import { NextRequest, NextResponse } from "next/server";
import { requireSameBusiness } from "@/product/security/access";
import { getSaasStore } from "@/product/saas/runtime";
import { getSupportService } from "@/product/support/runtime";
import { canManageAccount } from "@/product/support/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!canManageAccount(access.ctx.membership.role, access.ctx.isPlatformAdmin)) {
    return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 });
  }
  const org = await getSaasStore().getOrganization(id);
  if (!org) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  const support = getSupportService();
  const tickets = await support.list(id);
  const accountRequests = await support.accountRequests(id);
  return NextResponse.json({
    ok: true,
    export: {
      organization: { id: org.id, name: org.name, plan: org.plan, city: org.city, serviceArea: org.serviceArea },
      tickets: tickets.map((ticket) => ({ id: ticket.id, subject: ticket.subject, status: ticket.status })),
      accountRequests: accountRequests.map((row) => ({ id: row.id, kind: row.kind, status: row.status, phoneRouting: row.phoneRouting })),
    },
  });
}
