import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { buildAgentConfig } from "@/product/receptionist/agent-config";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/**
 * Ops-only: the realtime voice agent asks, per call, how to answer the number
 * that was dialed. Returns the business's rendered instructions and its
 * validated transfer lines. Bearer ops auth + X-Ops-Actor in production.
 */
export async function GET(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "receptionist.agent_config");
  if (audit.missingActor) return missingOpsActorResponse();

  const number = request.nextUrl.searchParams.get("number")?.trim() ?? "";
  if (digits(number).length < 10) {
    return NextResponse.json(
      { error: "Query parameter 'number' (E.164) is required." },
      { status: 400 },
    );
  }

  const runtime = getReceptionistRuntime();
  await runtime.refresh(false);
  // Exact number match only: an unknown number must never be answered as some
  // other business.
  const config = runtime.configs.find(
    (c) => c.enabled && digits(c.phoneNumberE164) === digits(number),
  );
  if (!config) {
    return NextResponse.json(
      { error: "No active receptionist for that number." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, config: buildAgentConfig(config) });
}
