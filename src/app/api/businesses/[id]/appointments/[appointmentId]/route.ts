import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; appointmentId: string }> };

const patchSchema = z.object({
  status: z.literal("completed").optional(),
  technicianId: z.string().optional(),
  customerName: z.string().max(160).optional(),
  serviceAddress: z.string().max(300).optional(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, appointmentId } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  try {
    const detail = await getSchedulingService().get(id, appointmentId);
    return NextResponse.json({ ok: true, ...detail });
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

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, appointmentId } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  try {
    const appointment = await getSchedulingService().updateDetails(
      id,
      appointmentId,
      parsed.data,
    );
    return NextResponse.json({ ok: true, appointment });
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
