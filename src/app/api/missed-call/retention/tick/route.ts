import { NextRequest, NextResponse } from "next/server";
import { authorizeOpsRequest, unauthorizedOpsResponse } from "@/lib/ops-auth";
import { isDurableMissedCallStoreConfigured } from "@/lib/config";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { purgeExpiredRecords } from "@/product/missed-call/retention";
import { applyPrivacyRetention } from "@/product/privacy/retention";

export const dynamic = "force-dynamic";

/**
 * Retention / soft-delete tick for Module A durable records.
 * Target: 24 months after last update (see privacy policy).
 *
 * Then each business's own privacy choices (SMS history off, 30/90/180-day
 * retention) clear message wording sooner. That pass runs even if the
 * platform pass fails, and its failure does not undo the platform pass.
 */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  if (!isDurableMissedCallStoreConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "durable_store_disabled",
    });
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return NextResponse.json(
      { error: "DATABASE_URL required" },
      { status: 503 },
    );
  }

  const months = Number(process.env.MISSED_CALL_RETENTION_MONTHS ?? "24");
  const pool = getPgPool(url);
  // One after the other: both touch mc_outbound_messages.
  const [platform] = await Promise.allSettled([
    purgeExpiredRecords(pool, {
      retentionMonths: Number.isFinite(months) && months > 0 ? months : 24,
    }),
  ]);
  const [business] = await Promise.allSettled([applyPrivacyRetention(pool)]);
  for (const outcome of [platform, business]) {
    if (outcome.status === "rejected")
      console.error(
        "[retention] pass failed",
        outcome.reason instanceof Error ? outcome.reason.name : "error",
      );
  }
  const ok = platform.status === "fulfilled" && business.status === "fulfilled";
  return NextResponse.json(
    {
      ok,
      ...(platform.status === "fulfilled" ? platform.value : {}),
      businessPrivacy:
        business.status === "fulfilled" ? business.value : { error: true },
      ...(platform.status === "rejected" ? { platformError: true } : {}),
    },
    { status: ok ? 200 : 500 },
  );
}

export const GET = tick;
export const POST = tick;
