import { NextRequest } from "next/server";
import { detailsSchema, handleBlandRequest } from "@/product/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: save the caller's name, callback number and service address
 * AFTER reading them back and getting a yes. The address is validated and
 * canonicalised (street number, city, province, postal code); what is still
 * missing or wrong comes back so the agent asks only for that. Confirmed
 * details are kept for the whole call and used by availability, booking and
 * the final record, so they are never re-typed from memory.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "details",
    detailsSchema,
    async ({ config, body, callId, callerE164, language, runtime }) => ({
      details: await runtime.blandCalls.saveDetails(config, {
        callId,
        fromE164: callerE164,
        language,
        callerName: body.caller_name,
        callbackPhone: body.callback_phone,
        useCallerId: body.use_caller_id,
        address: {
          address: body.address,
          street: body.street,
          unit: body.unit,
          city: body.city,
          province: body.province,
          postalCode: body.postal_code,
        },
      }),
    }),
  );
}
