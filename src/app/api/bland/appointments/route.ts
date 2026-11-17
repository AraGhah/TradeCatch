import { NextRequest } from "next/server";
import { appointmentActionSchema } from "@/product/receptionist/agent-api";
import { agentAppointments } from "@/product/receptionist/agent-operations";
import { handleBlandRequest } from "@/product/receptionist/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: the caller's existing appointments (find, move, cancel) and a
 * text to the caller's own number. The tool's body fixes `action`; the caller
 * is always Bland's `{{phone_number}}`, never a number the model chose.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "appointments",
    appointmentActionSchema,
    (ctx) =>
      agentAppointments({
        ...ctx,
        channel: "bland",
        requireLiveProvider: true,
      }),
  );
}
