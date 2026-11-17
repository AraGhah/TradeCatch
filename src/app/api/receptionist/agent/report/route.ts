import { NextRequest } from "next/server";
import {
  handleAgentRequest,
  reportSchema,
} from "@/product/receptionist/agent-api";
import { agentReport } from "@/product/receptionist/agent-operations";

export const dynamic = "force-dynamic";

/**
 * Ops-only: the voice agent's finished call. It becomes a normal receptionist
 * call record, so the owner gets the same summary, SMS/email, CRM sync and
 * missed-call recovery as for any other call. Repeating it is harmless.
 */
export async function POST(request: NextRequest) {
  return handleAgentRequest(request, "report", reportSchema, (ctx) =>
    agentReport(ctx),
  );
}
