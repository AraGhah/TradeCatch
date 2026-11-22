import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { syncAccountsDue } from "@/product/gmail/runtime";
import { authorizeGmailCron } from "@/product/gmail/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Fallback sync for mailboxes nobody has open. A small batch per tick keeps a
 * single scheduled run inside the Worker's subrequest budget; the oldest
 * attempted mailbox always goes first, so every connection gets its turn.
 */
async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(
    request,
    "gmail.sync.tick",
    authorizeGmailCron(request),
  );
  if (refusal) return refusal;

  const batch = Number(process.env.GMAIL_CRON_BATCH);
  const result = await syncAccountsDue(
    Number.isFinite(batch) && batch > 0 ? Math.min(Math.trunc(batch), 25) : 2,
  );
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
