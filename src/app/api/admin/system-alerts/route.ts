import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const alerts = await getNotificationService().listAlerts();
  return NextResponse.json({
    ok: true,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      component: alert.component,
      severity: alert.severity,
      message: alert.message,
      correlationId: alert.correlationId,
      createdAt: alert.createdAt,
      organizationId: alert.organizationId,
    })),
  });
}
