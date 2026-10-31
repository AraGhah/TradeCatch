import { NextRequest } from "next/server";
import {
  bookSchema,
  handleAgentRequest,
} from "@/product/receptionist/agent-api";

export const dynamic = "force-dynamic";

/**
 * Ops-only: reserve one of the offered times. The agent may tell the caller
 * the appointment is booked only when `booking.status` is "confirmed".
 */
export async function POST(request: NextRequest) {
  return handleAgentRequest(
    request,
    "book",
    bookSchema,
    async ({ config, body, runtime }) => ({
      booking: await runtime.agentCalls.book(config, {
        callId: body.callId,
        fromE164: body.from,
        language: body.language,
        startAt: body.startAt,
        serviceId: body.serviceId,
        serviceName: body.serviceName,
        timezone: body.timezone,
        callerName: body.callerName,
        callbackE164: body.callbackE164,
        serviceAddress: body.serviceAddress,
      }),
    }),
  );
}
