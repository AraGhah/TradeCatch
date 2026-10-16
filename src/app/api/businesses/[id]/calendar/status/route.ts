import { NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const calendar = await getSchedulingService().connectionStatus(id);
  return NextResponse.json({ ok: true, calendar });
}
