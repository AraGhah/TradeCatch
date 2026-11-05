import { NextRequest } from "next/server";
import {
  appointmentActionSchema,
  handleAgentRequest,
} from "@/product/receptionist/agent-api";

export const dynamic = "force-dynamic";

/**
 * Ops-only: the caller's existing appointments, and texts to the caller.
 *
 *   find   → upcoming appointments of the caller dialing from that number and giving that name
 *   move   → reschedule one of them to a time the availability lookup returned
 *   cancel → cancel one of them (the agent asks the caller to confirm first)
 *   text   → the business's details or a verified appointment, to the caller's own number
 *
 * The agent may say an appointment was moved or canceled, or a text was sent,
 * only when this endpoint says so.
 */
export async function POST(request: NextRequest) {
  return handleAgentRequest(
    request,
    "appointments",
    appointmentActionSchema,
    async ({ config, body, runtime }) => {
      const service = runtime.agentAppointments;
      const caller = { callerE164: body.from, callerName: body.callerName };
      switch (body.action) {
        case "find":
          return {
            result: await service.find(config, {
              ...caller,
              language: body.language,
            }),
          };
        case "move":
          return {
            result: await service.move(config, {
              ...caller,
              appointmentId: body.appointmentId,
              startAt: body.startAt,
              language: body.language,
            }),
          };
        case "cancel":
          return {
            result: await service.cancel(config, {
              ...caller,
              appointmentId: body.appointmentId,
            }),
          };
        case "text":
          return {
            result: await service.text(config, {
              ...caller,
              callId: body.callId,
              language: body.language,
              kind: body.kind,
              appointmentId: body.appointmentId,
            }),
          };
      }
    },
  );
}
