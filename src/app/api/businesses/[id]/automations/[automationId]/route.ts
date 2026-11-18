import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import {
  automationFailure,
  limitAutomationWrite,
} from "@/product/sms-automation/http";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; automationId: string }> };

/**
 * What an owner may change. The message category is not here on purpose: it fixes which
 * consent a text needs, so it belongs to the kind of automation, not to a setting.
 * Unknown fields are dropped.
 */
const patchSchema = z.object({
  trigger: z.string().trim().min(1).max(60).optional(),
  initialDelayMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30)
    .optional(),
  secondDelayMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 60)
    .optional(),
  language: z.enum(["en", "fr", "customer"]).optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  windowStartHour: z.number().int().min(0).max(23).optional(),
  windowEndHour: z.number().int().min(1).max(24).optional(),
  weekendSending: z.boolean().optional(),
  duplicateProtection: z.boolean().optional(),
  stopOnCustomerReply: z.boolean().optional(),
  stopOnHumanContact: z.boolean().optional(),
  stopOnQuoteAccepted: z.boolean().optional(),
  stopOnQuoteRejected: z.boolean().optional(),
  respectQuietHours: z.boolean().optional(),
});

/** The settings the screen has a sentence for, by the field that was refused. */
const FIELD_CODE: Record<string, string> = {
  initialDelayMinutes: "initial_delay",
  secondDelayMinutes: "second_delay",
  maxAttempts: "max_attempts",
  windowStartHour: "sending_window",
  windowEndHour: "sending_window",
  language: "language",
};

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, automationId } = await params;
  const access = await requireAutomationAccess(id, "read");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  try {
    const automations = await getAutomationServices().list(id);
    const automation = automations.find((row) => row.id === automationId);
    if (!automation) {
      return NextResponse.json(
        { error: "Automation not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, automation });
  } catch (err) {
    return automationFailure(err, "settings");
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, automationId } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  const limited = await limitAutomationWrite(id, access.ctx.user.id);
  if (limited) return limited;
  let json: unknown;
  try {
    json = await readJsonBounded(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid settings.",
        fields: [
          ...new Set(
            parsed.error.issues
              .map((issue) => FIELD_CODE[String(issue.path[0] ?? "")])
              .filter((code): code is string => Boolean(code)),
          ),
        ],
      },
      { status: 400 },
    );
  }
  try {
    const automation = await getAutomationServices().update(
      id,
      automationId,
      parsed.data,
    );
    return NextResponse.json({ ok: true, automation });
  } catch (err) {
    return automationFailure(err, "settings");
  }
}
