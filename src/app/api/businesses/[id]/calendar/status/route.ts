import { NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import {
  getGoogleSync,
  getSchedulingService,
} from "@/product/scheduling/runtime";
import { hasGoogleCalendarPilot } from "@/product/scheduling/availability";
import { googleCalendarConfigured } from "@/product/scheduling/google";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const calendar = await getSchedulingService().connectionStatus(id);
  const googlePilot = await hasGoogleCalendarPilot(id);
  // The synchronization picture (last sync, errors, what needs attention) is
  // read from what is stored, so it survives a refresh or a new login. It
  // holds appointment ids and times, never an event title or a token.
  const sync =
    googlePilot &&
    calendar.status !== "simulated" &&
    calendar.status !== "disconnected"
      ? await getGoogleSync()
          .summary(id)
          .catch(() => null)
      : null;
  // Times on this page are shown in the business's own zone, as in the calendar.
  const { timezone } = await getSchedulingService().getRules(id);
  return NextResponse.json({
    ok: true,
    calendar,
    sync,
    timezone,
    availability: {
      googlePilot,
      configured: googleCalendarConfigured(),
      outlook: "planned",
    },
  });
}
