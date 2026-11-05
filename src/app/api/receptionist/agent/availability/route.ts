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
    async ({ config, body, runtime }) => {
      // Moving an appointment: only the caller who owns it gets times, for its own service.
      let existing: {
        serviceId?: string;
        serviceAddress?: string;
        serviceName: string;
      } | null = null;
      if (body.appointmentId) {
        existing = await runtime.agentAppointments.forRescheduling(config, {
          callerE164: body.from,
          callerName: body.callerName,
          appointmentId: body.appointmentId,
        });
        if (!existing)
          return { availability: { ok: false, reason: "not_bookable" } };
      }
      return {
        availability: await runtime.agentCalls.availability(config, {
          callId: body.callId,
          fromE164: body.from,
          language: body.language,
          preferredTime: body.preferredTime,
          issue: existing ? existing.serviceName : body.issue,
          serviceAddress: existing
            ? existing.serviceAddress
            : body.serviceAddress,
          serviceId: existing?.serviceId,
        }),
      };
    },
  );
}
