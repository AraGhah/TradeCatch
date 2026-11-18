import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { refusalStatus, schedulingFailure } from "@/product/scheduling/http";
import { getSchedulingService } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; appointmentId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id, appointmentId } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = z
    .object({ startAt: z.string().min(8) })
    .safeParse(await readJsonBounded(request).catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid time." }, { status: 400 });
  try {
    const result = await getSchedulingService().reschedule(
      id,
      appointmentId,
      parsed.data.startAt,
    );
    return NextResponse.json(result, {
      status: result.ok
        ? 200
        : refusalStatus("reason" in result ? result.reason : undefined),
    });
  } catch (error) {
    return schedulingFailure(error, "reschedule appointment");
  }
}
