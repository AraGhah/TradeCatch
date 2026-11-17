import { NextRequest } from "next/server";
import {
  appointmentActionSchema,
  handleBlandRequest,
} from "@/product/bland/api";
import { smsTextingAllowed } from "@/product/bland/sms-guard";

export const dynamic = "force-dynamic";

/**
 * Bland tool: the caller's existing appointments, and texts to the caller.
 *
 *   find   → upcoming appointments of the caller dialing from that number and giving that name
 *   move   → reschedule one of them to a time the availability tool returned
 *   cancel → cancel one of them (the agent asks the caller to confirm first)
 *   text   → the business's details or a verified appointment, to the caller's own number
 *
 * The caller is always Bland's `from` (the carrier's caller ID), never a
 * number the model chose. The agent may say an appointment was moved or
 * canceled, or a text was sent, only when this endpoint says so.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(
    request,
    "appointments",
    appointmentActionSchema,
    async ({ config, body, callId, callerE164, language, runtime }) => {
      const service = runtime.agentAppointments;
      // The name the caller already confirmed on this call, unless they gave another.
      const confirmed = await runtime.blandCalls.confirmedDetails(config, {
        callId,
        fromE164: callerE164,
        language,
      });
      const caller = {
        callerE164,
        callerName: body.caller_name ?? confirmed.callerName,
      };
      switch (body.action) {
        case "find":
          return {
            result: await service.find(config, { ...caller, language }),
          };
        case "move":
          return {
            result: await service.move(config, {
              ...caller,
              appointmentId: body.appointment_id,
              startAt: body.start_at,
              language,
            }),
          };
        case "cancel":
          return {
            result: await service.cancel(config, {
              ...caller,
              appointmentId: body.appointment_id,
            }),
          };
        case "text":
          // A number Bland also texts from has another responder: no promise of a text.
          if (!smsTextingAllowed(config))
            return { result: { status: "unavailable" } };
          return {
            result: await service.text(config, {
              ...caller,
              callId,
              language,
              kind: body.kind,
              appointmentId: body.appointment_id,
            }),
          };
      }
    },
  );
}
