import { NextRequest } from "next/server";
import {
  appointmentActionSchema,
  handleAgentRequest,
} from "@/product/receptionist/agent-api";
import { agentAppointments } from "@/product/receptionist/agent-operations";

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
    (ctx) => agentAppointments(ctx),
  );
}
