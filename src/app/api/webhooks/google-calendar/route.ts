import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/safe-compare";
import { reconcileGoogleBusy } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

// A channel id is the organization id we registered, never free text.
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Google tells us that something changed. The body is not the event itself. */
export async function POST(request: NextRequest) {
  const expected = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN?.trim();
  const token = request.headers.get("x-goog-channel-token") ?? "";
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const organizationId = request.headers.get("x-goog-channel-id")?.trim();
  if (!organizationId || !CHANNEL_ID.test(organizationId)) {
    return NextResponse.json({ error: "Missing channel." }, { status: 400 });
  }
  const result = await reconcileGoogleBusy(organizationId);
  return NextResponse.json({ ok: true, ...result });
}
