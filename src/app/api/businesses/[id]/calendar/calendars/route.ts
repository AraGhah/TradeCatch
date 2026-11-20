import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import {
  hasGoogleCalendarPilot,
  calendarPilotDenied,
} from "@/product/scheduling/availability";
import {
  getSchedulingService,
  listGoogleCalendarsFor,
} from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (!(await hasGoogleCalendarPilot(id))) return calendarPilotDenied();
  const listed = await listGoogleCalendarsFor(id);
  if (!listed.ok) {
    if (listed.reason === "not_connected")
      return NextResponse.json({ ok: true, calendars: [] });
    return NextResponse.json(
      { ok: false, calendars: [], error: listed.error },
      { status: 409 },
    );
  }
  // Only the name the owner knows each calendar by, never anything else.
  return NextResponse.json({
    ok: true,
    calendars: listed.calendars.map(({ id: calendarId, summary }) => ({
      id: calendarId,
      summary,
    })),
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (!(await hasGoogleCalendarPilot(id))) return calendarPilotDenied();
  const parsed = z
    .object({
      calendarId: z.string().min(1).max(320),
      // Accepted for older clients, never trusted: the name comes from Google.
      summary: z.string().max(200).optional(),
    })
    .safeParse(await readJsonBounded(request).catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid calendar." }, { status: 400 });
  try {
    const listed = await listGoogleCalendarsFor(id);
    if (!listed.ok) {
      return NextResponse.json(
        { error: listed.error, code: listed.reason },
        { status: 409 },
      );
    }
    // Only a calendar this account can write to, taken from Google's own list.
    const chosen = listed.calendars.find(
      (calendar) => calendar.id === parsed.data.calendarId,
    );
    if (!chosen)
      return NextResponse.json(
        { error: "Calendar is not writable." },
        { status: 403 },
      );
    const calendar = await getSchedulingService().selectCalendar(
      id,
      chosen.id,
      chosen.summary,
    );
    return NextResponse.json({ ok: true, calendar });
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
