import { readJsonBounded } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { queueAnnouncement } from "@/product/admin/announcements";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { getNotificationService } from "@/product/notifications/runtime";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  message: z.string().trim().min(3).max(500),
  confirm: z.literal("announce"),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
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
  const parsed = schema.safeParse(
    await readJsonBounded(request).catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "confirm" }, { status: 400 });
  const orgs = (await getSaasStore().listOrganizations())
    .filter((org) => org.status === "active" && org.accountType !== "demo")
    .slice(0, 100);
  const service = getNotificationService();
  const { queued, alreadyQueued } = await queueAnnouncement({
    organizationIds: orgs.map((org) => org.id),
    message: parsed.data.message,
    idempotencyKey: parsed.data.idempotencyKey,
    enqueue: (event) => service.enqueue(event),
  });
  // A repeat changed nothing: answer as the first request did, without a second audit entry.
  if (queued === 0 && alreadyQueued > 0) {
    return NextResponse.json({
      ok: true,
      queued: alreadyQueued,
      duplicate: true,
    });
  }
  clearPlatformSnapshot();
  await recordSecurityEvent({
    actorUserId: access.ctx.user.id,
    action: "admin_announcement",
    detail: String(queued),
  });
  return NextResponse.json({ ok: true, queued });
}
