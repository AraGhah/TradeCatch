import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireNotificationAccess } from "@/product/notifications/access";
import { getNotificationService } from "@/product/notifications/runtime";
import { DEFAULT_CHANNELS } from "@/product/notifications/templates";
import type {
  NotificationPreferences,
  PreferenceCategory,
} from "@/product/notifications/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const channel = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
});
const schema = z.object({
  categories: z.record(z.string(), channel),
  quietStart: z.string(),
  quietEnd: z.string(),
  quietEnabled: z.boolean(),
  language: z.enum(["en", "fr"]),
  dailySummary: z.literal(false).optional().default(false),
  scope: z.enum(["all", "assigned"]),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const preferences = await getNotificationService().getPreferences(
    id,
    access.ctx.user.id,
    access.ctx.user.locale,
  );
  return NextResponse.json({ ok: true, preferences });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireNotificationAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid preferences." },
      { status: 400 },
    );
  const categories = { ...DEFAULT_CHANNELS };
  for (const [key, value] of Object.entries(parsed.data.categories)) {
    if (key in categories) categories[key as PreferenceCategory] = value;
  }
  const row: NotificationPreferences = {
    organizationId: id,
    userId: access.ctx.user.id,
    categories,
    quietStart: parsed.data.quietStart,
    quietEnd: parsed.data.quietEnd,
    quietEnabled: parsed.data.quietEnabled,
    language: parsed.data.language,
    dailySummary: parsed.data.dailySummary,
    scope:
      access.ctx.membership.role === "member" ? "assigned" : parsed.data.scope,
    updatedAt: new Date().toISOString(),
  };
  const preferences = await getNotificationService().savePreferences(row);
  return NextResponse.json({ ok: true, preferences });
}
