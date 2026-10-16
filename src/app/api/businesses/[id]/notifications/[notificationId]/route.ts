import { NextResponse } from "next/server";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";
import { NotificationError } from "@/product/notifications/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; notificationId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, notificationId } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const detail = await getNotificationService().getForUser(id, access.ctx.user.id, notificationId);
    return NextResponse.json({
      ok: true,
      notification: detail.notification,
      recipient: { readAt: detail.recipient.readAt, acknowledgedAt: detail.recipient.acknowledgedAt },
      deliveries: detail.deliveries.map((row) => ({
        channel: row.channel,
        status: row.status,
        attempts: row.attempts,
        simulated: row.simulated,
      })),
      escalation: detail.escalation,
    });
  } catch (error) {
    if (error instanceof NotificationError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
