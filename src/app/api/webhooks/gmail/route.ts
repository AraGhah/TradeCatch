import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { safeEqual } from "@/lib/safe-compare";
import { readGmailEnv } from "@/product/gmail/oauth";
import { parseGmailPush } from "@/product/gmail/push";
import {
  getGmailStore,
  isAccountActive,
  syncConnectedGmail,
} from "@/product/gmail/runtime";

export const dynamic = "force-dynamic";

function isNewer(pushed: string | undefined, known: string | null): boolean {
  if (!pushed || !known) return true;
  try {
    return BigInt(pushed) > BigInt(known);
  } catch {
    return true;
  }
}

/**
 * Pub/Sub push from Gmail's `users.watch`. The body only says "something
 * changed for this address"; the real work is the same incremental sync the
 * poller uses, so a lost or duplicated push can never lose or duplicate mail.
 * Failed or throttled imports return 503 so Pub/Sub retries until the cursor
 * has advanced. Replayed pushes are discarded using the saved history ID.
 */
export async function POST(request: NextRequest) {
  const env = readGmailEnv();
  const given = request.nextUrl.searchParams.get("token") || "";
  if (!env.webhookToken || !safeEqual(given, env.webhookToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const read = await readJsonBody(request, 65_536);
  if (!read.ok && read.status === 413)
    return NextResponse.json({ error: read.error }, { status: 413 });
  // Anything that is not a well-formed notification is acknowledged and dropped,
  // so Pub/Sub does not keep redelivering it.
  const push = read.ok ? parseGmailPush(read.data) : null;
  if (!push) return NextResponse.json({ ok: true, ignored: true });
  const { email, historyId } = push;

  // The same address can be connected in more than one workspace.
  const accounts = await getGmailStore().findAccountsByEmail(email);
  let synced = 0;
  let retry = false;
  for (const account of accounts) {
    // A push at or below what we already processed is a duplicate.
    if (!isNewer(historyId, account.historyId)) continue;
    try {
      if (!(await isAccountActive(account))) continue;
      const result = await syncConnectedGmail(
        account.organizationId,
        account.userId,
        "push",
      );
      if (result.ok && !result.skipped) synced += 1;
      else if (!("error" in result) || result.error !== "needs_reconnect")
        retry = true;
    } catch (error) {
      console.warn(
        "[gmail] push sync failed",
        error instanceof Error ? error.name : "unknown",
      );
      retry = true;
    }
  }
  return NextResponse.json(
    { ok: !retry, synced },
    { status: retry ? 503 : 200 },
  );
}
