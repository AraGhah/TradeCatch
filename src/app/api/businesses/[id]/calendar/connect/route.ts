import { NextRequest, NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import {
  buildGoogleAuthUrl,
  googleCalendarConfigured,
} from "@/product/scheduling/google";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (!googleCalendarConfigured()) {
    return NextResponse.json(
      { error: "Google Calendar is not configured on this server." },
      { status: 409 },
    );
  }
  const { url } = buildGoogleAuthUrl(id, access.ctx.user.id);
  return NextResponse.json({ ok: true, url });
}
