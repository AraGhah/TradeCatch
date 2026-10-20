import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const tickets = await getSupportService().list();
  return NextResponse.json({
    ok: true,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      organizationId: ticket.organizationId,
      subject: ticket.subject,
      category: ticket.category,
      kind: ticket.kind,
      priority: ticket.priority,
      status: ticket.status,
      assignedTo: ticket.assignedTo,
      updatedAt: ticket.updatedAt,
    })),
  });
}
