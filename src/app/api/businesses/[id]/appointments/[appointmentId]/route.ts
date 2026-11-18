import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parsePhoneInput } from "@/product/crm/phone";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { schedulingFailure } from "@/product/scheduling/http";
import { getSchedulingService } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; appointmentId: string }> };

const patchSchema = z.object({
  status: z.literal("completed").optional(),
  technicianId: z.string().optional(),
  customerName: z.string().max(160).optional(),
  // An empty string removes the number.
  customerPhoneE164: z.string().max(40).optional(),
  serviceAddress: z.string().max(300).optional(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, appointmentId } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  try {
    const detail = await getSchedulingService().get(id, appointmentId);
    return NextResponse.json(
      { ok: true, ...detail },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return schedulingFailure(error, "read appointment");
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, appointmentId } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = patchSchema.safeParse(
    await readJsonBounded(request).catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  // Reminders are texted to this number: store it only when it is one.
  const { customerPhoneE164: typed, ...rest } = parsed.data;
  let phone: string | null | undefined;
  if (typed !== undefined) {
    if (typed.trim() === "") phone = null;
    else {
      phone = parsePhoneInput(typed.trim());
      if (!phone)
        return NextResponse.json(
          { error: "Enter a valid phone number.", code: "invalid_phone" },
          { status: 400 },
        );
    }
  }
  try {
    const appointment = await getSchedulingService().updateDetails(
      id,
      appointmentId,
      { ...rest, ...(phone === undefined ? {} : { customerPhoneE164: phone }) },
    );
    return NextResponse.json({ ok: true, appointment });
  } catch (error) {
    return schedulingFailure(error, "update appointment");
  }
}
