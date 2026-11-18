import { NextRequest, NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { refusalStatus, schedulingFailure } from "@/product/scheduling/http";
import { getSchedulingService } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; appointmentId: string }> };

/** The contractor accepts a pending request; it becomes a confirmed appointment. */
export async function POST(_request: NextRequest, { params }: Params) {
  const { id, appointmentId } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  try {
    const result = await getSchedulingService().approve(id, appointmentId);
    return NextResponse.json(result, {
      status: result.ok
        ? 200
        : refusalStatus("reason" in result ? result.reason : undefined),
    });
  } catch (error) {
    return schedulingFailure(error, "approve appointment");
  }
}
