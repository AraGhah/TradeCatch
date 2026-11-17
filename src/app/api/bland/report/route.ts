import { NextRequest } from "next/server";
import { handleBlandRequest, reportSchema } from "@/product/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: save what the agent has learned about the request (the problem,
 * the service, the preferred time, a message, an emergency flag) on the call.
 * It does not finish the call: the signed post-call webhook (/api/bland/webhook)
 * finalizes it with the transcript, and the stale-call sweep finalizes any call
 * whose webhook never arrives, from what was saved here. Safe to call often.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "report",
    reportSchema,
    async ({ config, body, callId, callerE164, language, runtime }) => ({
      report: await runtime.blandCalls.recordSlots(config, {
        callId,
        fromE164: callerE164,
        language,
        intent: body.intent,
        emergency: body.emergency,
        slots: {
          issue: body.issue,
          service: body.service,
          project: body.project,
          preferredTime: body.preferred_time,
          message: body.message,
          email: body.email,
          location: body.location,
        },
      }),
    }),
  );
}
