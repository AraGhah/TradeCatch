import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const failures = await getNotificationService().listFailures();
  return NextResponse.json({
    ok: true,
    failures: failures.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      channel: row.channel,
      status: row.status,
      attempts: row.attempts,
      correlationId: row.id,
    })),
  });
}
