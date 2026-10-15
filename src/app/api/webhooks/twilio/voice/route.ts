import { NextRequest } from "next/server";
import { POST as receptionistPost } from "@/app/api/twilio/voice/receptionist/[step]/route";

export const dynamic = "force-dynamic";

/**
 * Canonical inbound voice webhook (Task 4).
 * Twilio → POST /api/webhooks/twilio/voice → receptionist incoming handler.
 */
export async function POST(request: NextRequest) {
  return receptionistPost(request, {
    params: Promise.resolve({ step: "incoming" }),
  });
}
