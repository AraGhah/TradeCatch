import { NextRequest, NextResponse } from "next/server";
import { authorizeOpsRequest, unauthorizedOpsResponse } from "@/lib/ops-auth";
import { isDurableMissedCallStoreConfigured } from "@/lib/config";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { purgeExpiredRecords } from "@/product/missed-call/retention";

export const dynamic = "force-dynamic";

/**
 * Retention / soft-delete tick for Module A durable records.
 * Target: 24 months after last update (see privacy policy).
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
  const result = await purgeExpiredRecords(getPgPool(url), {
    retentionMonths: Number.isFinite(months) && months > 0 ? months : 24,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
