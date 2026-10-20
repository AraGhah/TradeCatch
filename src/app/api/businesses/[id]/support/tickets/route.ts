import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameBusiness } from "@/product/security/access";
import { SupportError } from "@/product/support/service";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  subject: z.string().min(3).max(140),
  category: z.enum(["ai", "calls", "sms", "appointments", "billing", "other"]),
  kind: z.enum(["issue", "bug", "feature"]).default("issue"),
  description: z.string().min(3).max(4000),
  priority: z.enum(["normal", "high", "critical"]),
  contactEmail: z.string().email(),
  relatedCallId: z.string().max(80).optional(),
  attachmentNames: z.array(z.string().min(1).max(120)).max(3).optional(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const tickets = await getSupportService().list(id);
  return NextResponse.json({
    ok: true,
    tickets: tickets.map((item) => {
      const ticket: Partial<typeof item> = { ...item };
      delete ticket.description;
      return ticket;
    }),
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
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
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid ticket." }, { status: 400 });
  try {
    const ticket = await getSupportService().createTicket({
      organizationId: id,
      ...parsed.data,
    });
    return NextResponse.json({
      ok: true,
      ticket: { id: ticket.id, status: ticket.status },
    });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Invalid ticket." }, { status });
  }
}
