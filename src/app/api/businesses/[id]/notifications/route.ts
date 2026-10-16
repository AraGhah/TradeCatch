import { NextRequest, NextResponse } from "next/server";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const rows = await getNotificationService().listForUser(id, access.ctx.user.id, {
    type: url.searchParams.get("type") || undefined,
    priority: url.searchParams.get("priority") || undefined,
    status: url.searchParams.get("status") || undefined,
    q: url.searchParams.get("q") || undefined,
  });
  return NextResponse.json({
    ok: true,
    notifications: rows.map((row) => ({
      ...row.note,
      readAt: row.recipient?.readAt,
      acknowledgedAt: row.recipient?.acknowledgedAt,
    })),
  });
}
