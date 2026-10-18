import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { readGmailEnv } from "@/product/gmail/oauth";
import { getGmailStore, isAccountActive, syncConnectedGmail } from "@/product/gmail/runtime";

export const dynamic = "force-dynamic";

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
 * Always answers 2xx once authenticated so Pub/Sub does not retry-storm.
 */
export async function POST(request: NextRequest) {
  const env = readGmailEnv();
  const given = request.nextUrl.searchParams.get("token") || "";
  if (!env.webhookToken || !tokenMatches(given, env.webhookToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { message?: { data?: string } } | null;
  const data = body?.message?.data;
  if (!data) return NextResponse.json({ ok: true, ignored: true });

  let email = "";
  let historyId: string | undefined;
  try {
    const decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as {
      emailAddress?: string;
      historyId?: string | number;
    };
    email = decoded.emailAddress || "";
    historyId = decoded.historyId === undefined ? undefined : String(decoded.historyId);
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (!email) return NextResponse.json({ ok: true, ignored: true });

  // The same address can be connected in more than one workspace.
  const accounts = await getGmailStore().findAccountsByEmail(email);
  let synced = 0;
  for (const account of accounts) {
    // A push at or below what we already processed is a duplicate.
    if (!isNewer(historyId, account.historyId)) continue;
    try {
      if (!(await isAccountActive(account))) continue;
      const result = await syncConnectedGmail(account.organizationId, account.userId, "push");
      if (result.ok) synced += 1;
    } catch (error) {
      console.warn("[gmail] push sync failed", error instanceof Error ? error.message : "unknown");
    }
  }
  return NextResponse.json({ ok: true, synced });
}
