import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@/lib/id";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  durationMinutes: z.number().int().min(15).max(480),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  bookingMode: z.enum([
    "automatic",
    "consultation",
    "manual_approval",
    "escalate",
  ]),
  eligibleTechnicianIds: z.array(z.string()).default([]),
  serviceArea: z.string().max(200).optional(),
  active: z.boolean().default(true),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const services = await getSchedulingService().listServices(id);
  return NextResponse.json({ ok: true, services });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid service." }, { status: 400 });
  try {
    const service = await getSchedulingService().saveService({
      ...parsed.data,
      id: parsed.data.id || createId("svc"),
      organizationId: id,
    });
    return NextResponse.json({ ok: true, service });
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
