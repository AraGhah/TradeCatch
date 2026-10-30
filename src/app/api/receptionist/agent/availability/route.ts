import { NextRequest } from "next/server";
import {
  availabilitySchema,
  handleAgentRequest,
} from "@/product/receptionist/agent-api";

export const dynamic = "force-dynamic";

/**
 * Ops-only: real openings for the voice agent to read out. Only times returned
 * here may be offered to the caller; `ok: false` means offer a callback instead.
 */
export async function POST(request: NextRequest) {
  return handleAgentRequest(
    request,
    "availability",
    availabilitySchema,
    async ({ config, body, runtime }) => ({
      availability: await runtime.agentCalls.availability(config, {
        callId: body.callId,
        fromE164: body.from,
        language: body.language,
        preferredTime: body.preferredTime,
        issue: body.issue,
        serviceAddress: body.serviceAddress,
      }),
    }),
  );
}
