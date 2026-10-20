import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { recordSecurityEvent } from "@/product/security/hooks";
import { SupportError } from "@/product/support/service";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ ticketId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const { ticketId } = await params;
  const parsed = z
    .object({
      body: z.string().min(1).max(4000),
      internal: z.boolean().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid message." }, { status: 400 });
  try {
    const existing = await getSupportService().forAdmin(ticketId);
    const message = await getSupportService().reply({
      organizationId: existing.ticket.organizationId,
      ticketId,
      body: parsed.data.body,
      authorRole: "admin",
      internal: parsed.data.internal,
    });
    await recordSecurityEvent({
      organizationId: existing.ticket.organizationId,
      action: parsed.data.internal ? "support_internal_note" : "support_reply",
      target: ticketId,
    });
    return NextResponse.json({
      ok: true,
      message: { id: message.id, internal: message.internal },
    });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Ticket not found." }, { status });
  }
}
