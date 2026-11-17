import { NextRequest } from "next/server";
import { availabilitySchema, handleBlandRequest } from "@/product/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: real openings to read out. Only times returned here may be
 * offered; `availability.ok: false` means offer a callback instead.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "availability",
    availabilitySchema,
    async ({ config, body, callId, callerE164, language, runtime }) => {
      // Moving an appointment: only the caller who owns it gets times, for its own service.
      let existing: {
        serviceId?: string;
        serviceAddress?: string;
        serviceName: string;
      } | null = null;
      if (body.appointment_id) {
        const confirmed = await runtime.blandCalls.confirmedDetails(config, {
          callId,
          fromE164: callerE164,
          language,
        });
        existing = await runtime.agentAppointments.forRescheduling(config, {
          callerE164,
          callerName: body.caller_name ?? confirmed.callerName,
          appointmentId: body.appointment_id,
        });
        if (!existing)
          return { availability: { ok: false, reason: "not_bookable" } };
      }
      return {
        availability: await runtime.blandCalls.availability(config, {
          callId,
          fromE164: callerE164,
          language,
          preferredTime: body.preferred_time,
          issue: existing ? existing.serviceName : body.issue,
          serviceAddress: existing?.serviceAddress,
          serviceId: existing?.serviceId,
        }),
      };
    },
  );
}
