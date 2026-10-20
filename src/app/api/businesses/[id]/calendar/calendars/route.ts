import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { listGoogleCalendars, openTokens } from "@/product/scheduling/google";
import {
  getSchedulingService,
  getSchedulingStore,
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
  const connection = await getSchedulingStore().getConnection(id);
  if (!connection?.tokenCiphertext)
    return NextResponse.json({ ok: true, calendars: [] });
  try {
    const calendars = await listGoogleCalendars(
      openTokens(connection.tokenCiphertext),
    );
    return NextResponse.json({ ok: true, calendars });
  } catch {
    return NextResponse.json(
      { ok: false, calendars: [], error: "calendar_unavailable" },
      { status: 409 },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = z
    .object({
      calendarId: z.string().min(1),
      summary: z.string().min(1).max(200),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid calendar." }, { status: 400 });
  try {
    const connection = await getSchedulingStore().getConnection(id);
    if (connection?.tokenCiphertext) {
      const calendars = await listGoogleCalendars(
        openTokens(connection.tokenCiphertext),
      );
      const allowed = calendars.some(
        (calendar) => calendar.id === parsed.data.calendarId,
      );
      if (!allowed)
        return NextResponse.json(
          { error: "Calendar is not writable." },
          { status: 403 },
        );
    }
    const calendar = await getSchedulingService().selectCalendar(
      id,
      parsed.data.calendarId,
      parsed.data.summary,
    );
    return NextResponse.json({ ok: true, calendar });
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
