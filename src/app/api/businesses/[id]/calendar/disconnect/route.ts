import { NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * Stops synchronizing and removes TradeCatch's access. Revoking the grant at
 * Google, stopping the push channel, clearing the stored credential and the
 * mirror all happen in the service; appointments are never touched.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  await getSchedulingService().disconnect(id);
  return NextResponse.json({
    ok: true,
    calendar: await getSchedulingService().connectionStatus(id),
  });
}
