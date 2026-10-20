import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import {
  getSchedulingStore,
  getSchedulingService,
} from "@/product/scheduling/runtime";
import {
  createSchedulingService,
  SchedulingError,
} from "@/product/scheduling/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum([
    "availability",
    "book",
    "reschedule",
    "cancel",
    "calendar_failure",
  ]),
  serviceId: z.string().optional(),
  startAt: z.string().optional(),
  customerName: z.string().optional(),
  customerPhoneE164: z.string().optional(),
  serviceAddress: z.string().optional(),
  appointmentId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid test." }, { status: 400 });
  const live = getSchedulingService();
  try {
    if (parsed.data.action === "availability") {
      const result = await live.availability({
        organizationId: id,
        serviceId: parsed.data.serviceId,
        serviceAddress: parsed.data.serviceAddress,
        from: parsed.data.startAt,
      });
      return NextResponse.json({
        ok: true,
        confirmed: false,
        slots: result.slots,
      });
    }
    if (parsed.data.action === "calendar_failure") {
      const failing = createSchedulingService({
        store: getSchedulingStore(),
        now: () => new Date(),
        calendar: async () => ({
          kind: "google" as const,
          connected: true,
          externalCalls: 0,
          freeBusy: async () => [],
          createEvent: async () => ({ error: "calendar_unavailable" }),
          updateEvent: async () => ({ error: "calendar_unavailable" }),
          deleteEvent: async () => ({ error: "calendar_unavailable" }),
        }),
      });
      const rules = await failing.getRules(id);
      const previous = rules.calendarMode;
      rules.calendarMode = "google";
      await failing.saveRules(rules);
      try {
        const result = await failing.book({
          organizationId: id,
          serviceId: parsed.data.serviceId,
          startAt: parsed.data.startAt || new Date().toISOString(),
          customerName: parsed.data.customerName || "Test Customer",
          customerPhoneE164: parsed.data.customerPhoneE164,
          serviceAddress: parsed.data.serviceAddress,
          source: "simulation",
          simulated: false,
        });
        return NextResponse.json({ ...result, externalCalendarCalls: 0 });
      } finally {
        rules.calendarMode = previous;
        await failing.saveRules(rules);
      }
    }
    if (!parsed.data.startAt && parsed.data.action === "book") {
      return NextResponse.json(
        { error: "startAt is required." },
        { status: 400 },
      );
    }
    if (parsed.data.action === "book") {
      const result = await live.book({
        organizationId: id,
        serviceId: parsed.data.serviceId,
        startAt: parsed.data.startAt!,
        customerName: parsed.data.customerName || "Test Customer",
        customerPhoneE164: parsed.data.customerPhoneE164,
        serviceAddress: parsed.data.serviceAddress,
        idempotencyKey: parsed.data.idempotencyKey,
        source: "simulation",
        simulated: true,
      });
      return NextResponse.json(result);
    }
    if (!parsed.data.appointmentId) {
      return NextResponse.json(
        { error: "appointmentId is required." },
        { status: 400 },
      );
    }
    if (parsed.data.action === "reschedule") {
      const result = await live.reschedule(
        id,
        parsed.data.appointmentId,
        parsed.data.startAt || "",
      );
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }
    const result = await live.cancel(
      id,
      parsed.data.appointmentId,
      "simulation",
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof SchedulingError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
