import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  serviceId: z.string().optional(),
  serviceName: z.string().max(160).optional(),
  startAt: z.string().min(8),
  customerName: z.string().max(160).optional(),
  customerPhoneE164: z.string().max(20).optional(),
  customerEmail: z.string().email().optional(),
  serviceAddress: z.string().max(300).optional(),
  technicianId: z.string().optional(),
  leadId: z.string().optional(),
  idempotencyKey: z.string().max(120).optional(),
  simulated: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const url = new URL(request.url);
  const service = getSchedulingService();
  const [appointments, technicians, connection] = await Promise.all([
    service.list(id, {
      status: url.searchParams.get("status") || undefined,
      technicianId: url.searchParams.get("technicianId") || undefined,
      q: url.searchParams.get("q") || undefined,
    }),
    service.listTechnicians(id),
    service.connectionStatus(id),
  ]);
  return NextResponse.json({
    ok: true,
    appointments,
    technicians,
    calendar: connection,
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid appointment." },
      { status: 400 },
    );
  try {
    const result = await getSchedulingService().book({
      organizationId: id,
      ...parsed.data,
      source: parsed.data.simulated ? "simulation" : "dashboard",
    });
    return NextResponse.json(result, { status: result.confirmed ? 201 : 200 });
  } catch (error) {
    if (error instanceof SchedulingError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
