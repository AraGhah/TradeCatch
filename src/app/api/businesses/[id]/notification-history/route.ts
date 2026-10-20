import { NextResponse } from "next/server";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const deliveries = await getNotificationService().history(id);
  return NextResponse.json({
    ok: true,
    deliveries: deliveries.map((row) => ({
      id: row.id,
      channel: row.channel,
      status: row.status,
      attempts: row.attempts,
      simulated: row.simulated,
      notificationId: row.notificationId,
      updatedAt: row.updatedAt,
    })),
  });
}
