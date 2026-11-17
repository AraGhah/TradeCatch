import { NextRequest } from "next/server";
import { agentReport } from "@/product/receptionist/agent-operations";
import { handleBlandRequest } from "@/product/receptionist/bland/api";
import { blandReportSchema } from "@/product/receptionist/bland/schemas";

export const dynamic = "force-dynamic";

/**
 * Bland tool: the finished call. It becomes a normal receptionist call record
 * (summary, owner alerts, CRM sync). Repeating it is harmless.
 *
 * A transfer reported by the model cannot confirm a person answered (Bland's
 * own transfer result is not visible here), so the schema always sets
 * `answerConfirmed` to false: the owner is alerted exactly as for a transfer
 * nobody confirmed.
 */
export async function POST(request: NextRequest) {
  return handleBlandRequest(request, "report", blandReportSchema, (ctx) =>
    agentReport({ ...ctx, channel: "bland" }),
  );
}
