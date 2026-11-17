import { NextRequest } from "next/server";
import { bookSchema, handleBlandRequest } from "@/product/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: book one of the times the availability tool returned. The
 * caller's name, callback number and address are NOT inputs: they are the ones
 * saved with the details tool, so a booking can never carry a value the caller
 * did not confirm. Only `booking.status: "confirmed"` lets the agent say
 * "booked". Repeating the call for the same time books nothing twice.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "book",
    bookSchema,
    async ({ config, body, callId, callerE164, language, runtime }) => ({
      booking: await runtime.blandCalls.book(config, {
        callId,
        fromE164: callerE164,
        language,
        startAt: body.start_at,
        serviceId: body.service_id,
        serviceName: body.service_name,
        timezone: body.timezone,
        strictAddress: true,
      }),
    }),
  );
}
