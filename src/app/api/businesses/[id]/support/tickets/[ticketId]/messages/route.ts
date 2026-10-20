import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameBusiness } from "@/product/security/access";
import { SupportError } from "@/product/support/service";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; ticketId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id, ticketId } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (access.ctx.membership.role === "viewer")
    return NextResponse.json(
      { error: "Insufficient permissions." },
      { status: 403 },
    );
  const parsed = z
    .object({ body: z.string().min(1).max(4000) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid message." }, { status: 400 });
  try {
    const message = await getSupportService().reply({
      organizationId: id,
      ticketId,
      body: parsed.data.body,
      authorRole: "contractor",
    });
    return NextResponse.json({ ok: true, message: { id: message.id } });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Ticket not found." }, { status });
  }
}
