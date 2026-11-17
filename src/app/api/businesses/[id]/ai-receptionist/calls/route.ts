import { ownerVisibleCalls } from "@/product/receptionist/call-history";
import { NextRequest, NextResponse } from "next/server";
import {
  filterCalls,
  parseCallFilters,
  toCallRow,
} from "@/product/receptionist/call-history-view";
import { receptionistErrorCode } from "@/product/receptionist/diagnostics";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Newest sessions read before filtering, so a filter can reach past `limit`. */
const SCAN_LIMIT = 500;

/**
 * Tenant-scoped call history (real + simulated `sim_*` sessions).
 * Filters: `from` / `to` (YYYY-MM-DD, business time zone), `urgency`, `outcome`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json({ ok: true, calls: [] });
  }

  const parsed = parseCallFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid filter.", field: parsed.field },
      { status: 400 },
    );
  }
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit")) || 50,
    200,
  );
  const runtime = getReceptionistRuntime();
  // The store query is scoped to this business; nothing below widens it.
  let sessions: ReturnType<typeof ownerVisibleCalls>;
  try {
    sessions = ownerVisibleCalls(
      await runtime.store.listSessions({
        clientAccountId: client.id,
        limit: SCAN_LIMIT,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "tradecatch.calls.list_failed",
        errorCode: receptionistErrorCode(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "Calls could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({
    ok: true,
    // Times are stored in UTC; this is the zone to show them in.
    timezone: client.timezone,
    calls: filterCalls(sessions, parsed.filters, client.timezone)
      .slice(0, limit)
      .map(toCallRow),
  });
}
