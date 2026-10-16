import { NextRequest } from "next/server";
import { POST as receptionistPost } from "@/app/api/twilio/voice/receptionist/[step]/route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return receptionistPost(request, {
    params: Promise.resolve({ step: "dial" }),
  });
}
