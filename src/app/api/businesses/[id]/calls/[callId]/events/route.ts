import { NextRequest, NextResponse } from "next/server";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getTelephonyRuntime } from "@/product/telephony/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; callId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id, callId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const runtime = getReceptionistRuntime();
  const session =
    (await runtime.store.getSession(callId)) ||
    (await runtime.store.getSessionByCallSid(callId));

  if (!session || session.clientAccountId !== client.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const events = await getTelephonyRuntime().events.listForCall({
    organizationId: id,
    callSid: session.callSid,
  });

  return NextResponse.json({ ok: true, events });
}
