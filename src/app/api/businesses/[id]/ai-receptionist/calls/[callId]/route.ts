import { NextRequest, NextResponse } from "next/server";
import { toCallDetail } from "@/product/receptionist/call-history-view";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; callId: string }> };

/**
 * One call of this business, with its delivery log and (when the plan and
 * retention allow) the transcript. A call that belongs to another business is
 * indistinguishable from one that does not exist.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id, callId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client || !/^[A-Za-z0-9_.:-]{1,160}$/.test(callId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const runtime = getReceptionistRuntime();
  const session = await runtime.store.getSession(callId);
  if (!session || session.clientAccountId !== client.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const config = runtime.configs.find((c) => c.id === session.configId);
  return NextResponse.json({
    ok: true,
    call: toCallDetail(session, {
      transcriptsEnabled: config?.transcriptsEnabled !== false,
    }),
  });
}
