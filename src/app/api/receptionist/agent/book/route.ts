import { NextRequest } from "next/server";
import {
  bookSchema,
  handleAgentRequest,
} from "@/product/receptionist/agent-api";
import { agentBook } from "@/product/receptionist/agent-operations";

export const dynamic = "force-dynamic";

/**
 * Ops-only: reserve one of the offered times. The agent may tell the caller
 * the appointment is booked only when `booking.status` is "confirmed".
 */
export async function POST(request: NextRequest) {
  return handleAgentRequest(request, "book", bookSchema, (ctx) =>
    agentBook(ctx),
  );
}
