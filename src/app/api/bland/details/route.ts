import { NextRequest } from "next/server";
import { agentDetails } from "@/product/receptionist/agent-operations";
import { handleBlandRequest } from "@/product/receptionist/bland/api";
import { blandDetailsSchema } from "@/product/receptionist/bland/schemas";

export const dynamic = "force-dynamic";

/**
 * Bland tool: save what the caller has confirmed so far (name, number,
 * address, the problem). Saved on the call as it is said, so a dropped call
 * or a later tool call that forgets a field loses nothing.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(request, "details", blandDetailsSchema, (ctx) =>
    agentDetails({ ...ctx, channel: "bland" }),
  );
}
