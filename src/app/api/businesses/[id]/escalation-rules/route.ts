import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";
import type { EscalationRule } from "@/product/notifications/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  enabled: z.boolean(),
  primaryUserId: z.string().optional(),
  secondaryUserId: z.string().optional(),
  secondaryPhoneE164: z.string().optional(),
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  acknowledgementRequired: z.boolean(),
  delayMinutes: z.number().int().min(1).max(240),
  maxAttempts: z.number().int().min(1).max(5),
  afterHours: z.boolean(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const rule = await getNotificationService().getEscalation(id);
  return NextResponse.json({ ok: true, rule });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid escalation rule." },
      { status: 400 },
    );
  const rule: EscalationRule = {
    ...parsed.data,
    organizationId: id,
    updatedAt: new Date().toISOString(),
  };
  return NextResponse.json({
    ok: true,
    rule: await getNotificationService().saveEscalation(rule),
  });
}
