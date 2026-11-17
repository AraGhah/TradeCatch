import { NextRequest } from "next/server";
import { handleBlandConfig } from "@/product/receptionist/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland: call-start data for one line (the inbound number's `dynamic_data`).
 * Authenticated with that line's own token; returns the business's facts, the
 * actions that are really available on this call and the validated transfer
 * numbers. See docs/BLAND_AI_INTEGRATION.md.
 */
export async function GET(request: NextRequest) {
  return handleBlandConfig(request);
}
