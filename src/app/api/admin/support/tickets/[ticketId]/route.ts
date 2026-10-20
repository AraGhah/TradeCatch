import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { recordSecurityEvent } from "@/product/security/hooks";
import { SupportError } from "@/product/support/service";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ ticketId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const { ticketId } = await params;
  try {
    const detail = await getSupportService().forAdmin(ticketId);
    let relatedLogs: {
      id: string;
      service: string;
      errorCode: string;
      createdAt: string;
    }[] = [];
    try {
      const { getReliabilityService } =
        await import("@/product/reliability/runtime");
      const errors = await getReliabilityService().listErrors({
        organizationId: detail.ticket.organizationId,
      });
      relatedLogs = errors.slice(-8).map((row) => ({
        id: row.id,
        service: row.service,
        errorCode: row.errorCode,
        createdAt: row.createdAt,
      }));
    } catch {
      relatedLogs = [];
    }
    return NextResponse.json({
      ok: true,
      ticket: detail.ticket,
      messages: detail.messages,
      relatedLogs,
    });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Ticket not found." }, { status });
  }
}

const patchSchema = z.object({
  status: z.enum([
    "open",
    "investigating",
    "waiting_for_customer",
    "in_progress",
    "resolved",
    "closed",
  ]),
  priority: z.enum(["normal", "high", "critical"]).optional(),
  assignedTo: z.string().max(120).optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const { ticketId } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  try {
    const ticket = await getSupportService().setStatus(
      ticketId,
      parsed.data.status,
      {
        priority: parsed.data.priority,
        assignedTo: parsed.data.assignedTo,
      },
    );
    await recordSecurityEvent({
      organizationId: ticket.organizationId,
      action: "support_ticket_updated",
      target: ticket.id,
      detail: ticket.status,
    });
    return NextResponse.json({
      ok: true,
      ticket: {
        id: ticket.id,
        status: ticket.status,
        priority: ticket.priority,
      },
    });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Invalid update." }, { status });
  }
}
