import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { parsePhoneInput } from "@/product/crm/phone";
import { schedulingFailure } from "@/product/scheduling/http";
import { getSchedulingService } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  customerName: z.string().trim().max(120).optional(),
  customerPhoneE164: z.string().trim().min(8).max(32).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "APPOINTMENT_BOOKING")) {
    return forbiddenFeatureResponse("APPOINTMENT_BOOKING");
  }

  // The same appointments the calendar shows: one table, one set of rules.
  try {
    const appointments = await getSchedulingService().list(
      auth.ctx.organization.id,
    );
    return NextResponse.json(
      { ok: true, appointments },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return schedulingFailure(error, "list bookings");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "APPOINTMENT_BOOKING")) {
    return forbiddenFeatureResponse("APPOINTMENT_BOOKING");
  }
  const denied = forbiddenUnless(
    auth.ctx.membership.role,
    "write_leads",
    auth.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  let json: unknown;
  try {
    json = await readJsonBounded(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid booking body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const typedPhone = parsed.data.customerPhoneE164?.trim();
  const phone = typedPhone ? parsePhoneInput(typedPhone) : undefined;
  if (typedPhone && !phone) {
    return NextResponse.json(
      { error: "Enter a valid phone number.", code: "invalid_phone" },
      { status: 400 },
    );
  }

  // An end before the start is a typo, not an appointment. The length of the
  // visit itself follows the service's duration (the response carries the
  // `endAt` that was booked), so the end is only checked, never trusted.
  if (
    parsed.data.endsAt &&
    Date.parse(parsed.data.endsAt) <= Date.parse(parsed.data.startsAt)
  ) {
    return NextResponse.json(
      { error: "The end must be after the start.", code: "invalid_range" },
      { status: 400 },
    );
  }

  // One booking path. It used to save into a table the calendar, the
  // dashboard and the receptionist never read, with none of the business's
  // hours, notice, buffer or overlap rules. Now it is the same booking
  // everywhere: same rules, same conflict answer, same reminders.
  try {
    const result = await getSchedulingService().book({
      organizationId: auth.ctx.organization.id,
      serviceName: parsed.data.title,
      startAt: parsed.data.startsAt,
      customerName: parsed.data.customerName,
      customerPhoneE164: phone ?? undefined,
      source: "manual",
      requestIfUnavailable: false,
    });
    if (result.reason === "conflict") {
      return NextResponse.json(
        {
          ...result,
          error:
            "This time is no longer available. Please select another time.",
        },
        { status: 409 },
      );
    }
    if (!result.appointment) {
      return schedulingFailure(
        new Error(result.reason ?? "not booked"),
        "book",
      );
    }
    return NextResponse.json({
      ok: result.ok,
      confirmed: result.confirmed,
      appointment: result.appointment,
    });
  } catch (error) {
    return schedulingFailure(error, "book");
  }
}
