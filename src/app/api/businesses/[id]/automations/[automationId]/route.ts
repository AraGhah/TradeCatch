import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { AutomationError } from "@/product/sms-automation/service";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; automationId: string }> };

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
  messageCategory: z
    .enum([
      "inquiry_response",
      "requested_estimate",
      "appointment_service",
      "marketing",
    ])
    .optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, automationId } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings." }, { status: 400 });
  }
  try {
    const automation = await getAutomationServices().update(
      id,
      automationId,
      parsed.data,
    );
    return NextResponse.json({ ok: true, automation });
  } catch (err) {
    if (err instanceof AutomationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
