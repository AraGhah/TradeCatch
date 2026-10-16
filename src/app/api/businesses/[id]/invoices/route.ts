import { NextRequest, NextResponse } from "next/server";
import { getBillingStore } from "@/product/billing/runtime";
import { authorizeBillingAccess } from "../billing/_shared";

export const dynamic = "force-dynamic";

/** GET /api/businesses/:id/invoices */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizeBillingAccess(request, id);
  if (!access.ok) return access.response;

  const invoices = await getBillingStore().listInvoices(id);
  return NextResponse.json({ ok: true, invoices });
}
