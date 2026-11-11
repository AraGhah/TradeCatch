import { NextRequest, NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";

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
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof SchedulingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
