import { NextRequest, NextResponse } from "next/server";
import { clientIpKey, getClientIp } from "@/lib/rate-limit";
import { enforcePolicy } from "@/lib/rate-limit-response";
import { getGoogleSync } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

// Channel ids and tokens are values we generated (url-safe base64), never free text.
const CHANNEL_ID = /^[A-Za-z0-9_-]{16,100}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;

/**
 * Google tells us that something changed. The body is empty and says nothing
 * about the event: the notification only makes us read the calendar.
 *
 * The business is identified by the channel id and its secret token, both
 * created by TradeCatch for that one business when it asked Google to push
 * (the token is stored only as a hash). There is no shared secret and nothing
 * in the request can name another tenant.
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id")?.trim() ?? "";
  const token = request.headers.get("x-goog-channel-token")?.trim() ?? "";
  if (!CHANNEL_ID.test(channelId) || !TOKEN.test(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Each notification can trigger calls to Google with that business's credentials.
  const limited = await enforcePolicy("public.calendar-hook", {
    subject: `${channelId}:${clientIpKey(getClientIp(request))}`,
  });
  if (limited) return limited;
  const number = Number(request.headers.get("x-goog-message-number"));
  const result = await getGoogleSync().receive({
    channelId,
    token,
    resourceState: request.headers.get("x-goog-resource-state") ?? undefined,
    messageNumber:
      Number.isSafeInteger(number) && number > 0 ? number : undefined,
  });
  if (result.status === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
