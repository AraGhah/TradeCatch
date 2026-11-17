import { NextRequest } from "next/server";
import { availabilitySchema } from "@/product/receptionist/agent-api";
import { agentAvailability } from "@/product/receptionist/agent-operations";
import { handleBlandRequest } from "@/product/receptionist/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: real openings to read out. Only times returned here may be
 * offered; `ok: false` means offer a callback. With no connected calendar
 * provider the answer is always `booking_disabled`.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "availability",
    availabilitySchema,
    (ctx) =>
      agentAvailability({
        ...ctx,
        channel: "bland",
        requireLiveProvider: true,
      }),
  );
}
