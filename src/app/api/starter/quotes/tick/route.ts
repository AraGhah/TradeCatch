import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { getStarterServices } from "@/product/starter/org-context";
import {
  resolveBusinessNameForOrganization,
  resolveSmsFromForOrganization,
} from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

/** Process due quote follow-up SMS (cron or manual ops). */
async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "starter.quotes.tick");
  if (refusal) return refusal;

  const services = getStarterServices();
  const result = await services.processDueQuotes({
    businessNameForOrg: resolveBusinessNameForOrganization,
    smsFromForOrg: resolveSmsFromForOrganization,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
