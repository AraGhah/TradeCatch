import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";
import { NOTIFICATION_TYPES } from "@/product/notifications/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  customer: z.string().max(80).optional(),
  service: z.string().max(120).optional(),
  location: z.string().max(80).optional(),
  whenLabel: z.string().max(80).optional(),
  consolidateKey: z.string().max(80).optional(),
  idempotencyKey: z.string().max(120).optional(),
  escalate: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "write");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification test." }, { status: 400 });
  const service = getNotificationService();
  const key = parsed.data.idempotencyKey || `sim:${parsed.data.type}:${Date.now()}`;
  const queued = await service.enqueue({
    organizationId: id,
    type: parsed.data.type,
    idempotencyKey: key,
    payload: {
      ...parsed.data,
      simulated: true,
      live: false,
      href: parsed.data.type.startsWith("appointment") ? "/app/bookings" : "/app/leads",
    },
  });
  await service.processDue(10);
  if (parsed.data.escalate) {
    await service.processEscalations(new Date(Date.now() + 24 * 60 * 60 * 1000));
  }
  return NextResponse.json({ ok: true, ...queued, simulated: true });
}
