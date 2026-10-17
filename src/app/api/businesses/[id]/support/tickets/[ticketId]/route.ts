import { NextRequest, NextResponse } from "next/server";
import { requireSameBusiness } from "@/product/security/access";
import { SupportError } from "@/product/support/service";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; ticketId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, ticketId } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const detail = await getSupportService().forBusiness(id, ticketId);
    return NextResponse.json({ ok: true, ticket: detail.ticket, messages: detail.messages });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Ticket not found." }, { status });
  }
}
