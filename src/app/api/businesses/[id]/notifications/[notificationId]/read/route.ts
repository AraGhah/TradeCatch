import { NextResponse } from "next/server";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";
import { NotificationError } from "@/product/notifications/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; notificationId: string }> };

export async function PATCH(_request: Request, { params }: Params) {
  const { id, notificationId } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  try {
    const recipient = await getNotificationService().markRead(
      id,
      access.ctx.user.id,
      notificationId,
    );
    return NextResponse.json({ ok: true, readAt: recipient.readAt });
  } catch (error) {
    if (error instanceof NotificationError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    throw error;
  }
}
