import { NextRequest } from "next/server";
import { bookSchema } from "@/product/receptionist/agent-api";
import { agentBook } from "@/product/receptionist/agent-operations";
import { handleBlandRequest } from "@/product/receptionist/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: reserve one of the offered times. The agent may say the
 * appointment is booked only when `booking.status` is "confirmed", which the
 * server returns only after the calendar provider accepted the booking.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(request, "book", bookSchema, (ctx) =>
    agentBook({ ...ctx, channel: "bland", requireLiveProvider: true }),
  );
}
