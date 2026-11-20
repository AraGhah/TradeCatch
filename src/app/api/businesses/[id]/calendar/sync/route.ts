import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import {
  hasGoogleCalendarPilot,
  calendarPilotDenied,
} from "@/product/scheduling/availability";
import {
  getGoogleSync,
  getSchedulingService,
} from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({
    action: z.literal("settings"),
    eventDetail: z.enum(["minimal", "standard"]).optional(),
    cancelPolicy: z.enum(["remove", "mark_canceled"]).optional(),
  }),
]);

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!(await hasGoogleCalendarPilot(id))) return calendarPilotDenied();
  return NextResponse.json({ ok: true, sync: await getGoogleSync().summary(id) });
}

/**
 * "Sync now" (failed changes get a fresh set of attempts) and the two settings
 * the owner controls: how much of the customer Google shows, and what a
 * cancellation does to the Google event.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!(await hasGoogleCalendarPilot(id))) return calendarPilotDenied();
  const parsed = body.safeParse(await readJsonBounded(request).catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const sync = getGoogleSync();
  try {
    if (parsed.data.action === "retry") {
      const result = await sync.retry(id);
      return NextResponse.json({
        ok: true,
        pull: result.pull.status,
        sync: await sync.summary(id),
      });
    }
    const before = await getSchedulingService().connectionStatus(id);
    const calendar = await getSchedulingService().updateCalendarSettings(id, {
      eventDetail: parsed.data.eventDetail,
      cancelPolicy: parsed.data.cancelPolicy,
    });
    // A different level of detail applies to the events that already exist too,
    // so switching to "minimal" really does take customer details back out.
    if (
      parsed.data.eventDetail &&
      parsed.data.eventDetail !== before.eventDetail
    ) {
      await sync.requeueAll(id);
      await sync.push({ organizationId: id, limit: 25 }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, calendar, sync: await sync.summary(id) });
  } catch (error) {
    if (error instanceof SchedulingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
