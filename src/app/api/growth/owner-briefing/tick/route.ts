import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { runOwnerBriefings } from "@/product/agent-tools/agents/owner-briefing";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

/** Sends the daily owner briefing (missed calls, leads recovered, jobs
 * booked, revenue, items waiting on the owner) to every active
 * organization that is due in its own local time zone. Read-only — no lead,
 * booking, or call record is written. Cron or manual ops only. */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "growth.owner-briefing.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }

  const organizations = (await getSaasStore().listOrganizations()).filter(
    (org) => org.status === "active",
  );
  const outcomes = await runOwnerBriefings(organizations);

  return NextResponse.json({
    ok: true,
    sent: outcomes.filter((o) => o.sent).length,
    skipped: outcomes.filter((o) => !o.sent).length,
  });
}

export const GET = tick;
export const POST = tick;
