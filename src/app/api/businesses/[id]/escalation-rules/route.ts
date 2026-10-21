import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";
import type { EscalationRule } from "@/product/notifications/types";
import { NotificationError } from "@/product/notifications/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  enabled: z.boolean(),
  primaryUserId: z.string().trim().min(1).max(100).optional(),
  secondaryUserId: z.string().trim().min(1).max(100).optional(),
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  acknowledgementRequired: z.boolean(),
  delayMinutes: z.number().int().min(1).max(240),
  maxAttempts: z.number().int().min(1).max(5),
  afterHours: z.boolean(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const service = getNotificationService();
  const [rule, contacts] = await Promise.all([
    service.getEscalation(id),
    service.listEscalationContacts(id),
  ]);
  return NextResponse.json(
    { ok: true, rule, contacts },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  try {
    return NextResponse.json({
      ok: true,
      rule: await getNotificationService().saveEscalation(rule),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof NotificationError
            ? error.message
            : "Could not save escalation settings.",
        code: error instanceof NotificationError ? error.code : undefined,
      },
      { status: error instanceof NotificationError ? error.status : 500 },
    );
  }
}
