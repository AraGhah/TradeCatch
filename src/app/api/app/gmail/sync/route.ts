import { NextRequest, NextResponse } from "next/server";
import { forbiddenOrigin, isSameOrigin } from "@/product/gmail/http";
import { getGmailStatus, syncConnectedGmail } from "@/product/gmail/runtime";
import type { SyncTrigger } from "@/product/gmail/sync";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

/**
 * `?mode=auto` is the background poller (cheap, heavily throttled);
 * `?mode=manual` is the Refresh button (still rate-limited per mailbox).
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const auth = await requireTenantContext();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const trigger: SyncTrigger =
    request.nextUrl.searchParams.get("mode") === "manual" ? "manual" : "auto";
  const { organization, user } = auth.ctx;

  const result = await syncConnectedGmail(organization.id, user.id, trigger);
  const status = await getGmailStatus(organization.id, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, status },
      { status: result.error === "not_connected" ? 200 : result.error === "rate_limited" ? 429 : 409 },
    );
  }
  return NextResponse.json({ ok: true, added: result.added, skipped: result.skipped, more: result.more, status });
}
