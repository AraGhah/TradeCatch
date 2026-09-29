import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

/** Full call record including transcript (PII — ops actor required). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const { id } = await params;
  const audit = logOpsAccess(request, "receptionist.calls.get", { id });
  if (audit.missingActor) return missingOpsActorResponse();

  const { store } = getReceptionistRuntime();
  const call =
    (await store.getSession(id)) ?? (await store.getSessionByCallSid(id));
  if (!call) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, call });
}
