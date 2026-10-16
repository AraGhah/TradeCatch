import { NextRequest, NextResponse } from "next/server";
import { getBillingStore } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/billing/history */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id);
  if (!access.ok) return access.response;

  const store = getBillingStore();
  const [events, audits, invoices] = await Promise.all([
    store.listSubscriptionEvents(id),
    store.listAuditLogs(id),
    store.listInvoices(id),
  ]);

  return NextResponse.json({
    ok: true,
    events,
    audits,
    invoices,
  });
}
