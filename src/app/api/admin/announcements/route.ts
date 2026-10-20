import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { getNotificationService } from "@/product/notifications/runtime";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  message: z.string().trim().min(3).max(500),
  confirm: z.literal("announce"),
});

export async function POST(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (!access.ctx)
    return NextResponse.json({ error: "session" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "confirm" }, { status: 400 });
  const orgs = (await getSaasStore().listOrganizations())
    .filter((org) => org.status === "active" && org.accountType !== "demo")
    .slice(0, 100);
  const service = getNotificationService();
  const stamp = Date.now().toString(36);
  let queued = 0;
  for (const org of orgs) {
    const result = await service.enqueue({
      organizationId: org.id,
      type: "support_update",
      idempotencyKey: `announce:${stamp}:${org.id}`,
      payload: { simulated: true, message: parsed.data.message },
    });
    if (result.queued) queued += 1;
  }
  clearPlatformSnapshot();
  await recordSecurityEvent({
    actorUserId: access.ctx.user.id,
    action: "admin_announcement",
    detail: String(queued),
  });
  return NextResponse.json({ ok: true, queued });
}
