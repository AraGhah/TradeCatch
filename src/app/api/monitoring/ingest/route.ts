import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeDatabaseErrorCode } from "@/lib/postgres-pool";
import { safeEqual } from "@/lib/safe-compare";
import { getReliabilityStore } from "@/product/reliability/runtime";
import type { BucketDelta } from "@/product/reliability/types";

export const dynamic = "force-dynamic";

/**
 * Request counters from the Worker (KAN-28). The Worker counts every response
 * into per-minute buckets in memory and posts them here in small batches; the
 * alert rules read the stored buckets to judge error rate and latency from
 * real traffic.
 *
 * Only the Worker may call this: the bearer must be the monitoring secret (or,
 * on installations without one, the same ops/cron secret the scheduler falls
 * back to). Unlike the operations routes there is NO open mode for local
 * development, because an open route here would let anyone write the numbers
 * that decide whether administrators are paged.
 *
 * What is accepted is deliberately narrow: counts and a minute, nothing else.
 * No path, user, address or message can be stored, because no such field exists.
 */

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ROWS = 120;
const MINUTE = 60_000;
const MAX_AGE_MS = 3 * 60 * MINUTE;
const MAX_FUTURE_MS = 5 * MINUTE;
const COUNT = z.number().int().min(0).max(1_000_000);

const rowSchema = z
  .object({
    at: z.string().datetime(),
    scope: z.enum(["api", "page"]),
    total: COUNT,
    s2xx: COUNT,
    s3xx: COUNT,
    s401: COUNT,
    s403: COUNT,
    s429: COUNT,
    s4xxOther: COUNT,
    s5xx: COUNT,
    lat: z.array(COUNT).length(7),
  })
  .strict();

const bodySchema = z
  .object({ rows: z.array(rowSchema).min(1).max(MAX_ROWS) })
  .strict();

function authorized(request: Request): boolean {
  const bearer = request.headers.get("authorization") || "";
  return [
    process.env.MONITORING_SECRET,
    process.env.MISSED_CALL_OPS_SECRET,
    process.env.CRON_SECRET,
  ]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret))
    .some((secret) => safeEqual(bearer, `Bearer ${secret}`));
}

function plausible(row: z.infer<typeof rowSchema>, now: number): boolean {
  const at = Date.parse(row.at);
  if (!Number.isFinite(at) || at % MINUTE !== 0) return false;
  if (at < now - MAX_AGE_MS || at > now + MAX_FUTURE_MS) return false;
  const statuses =
    row.s2xx +
    row.s3xx +
    row.s401 +
    row.s403 +
    row.s429 +
    row.s4xxOther +
    row.s5xx;
  const latencies = row.lat.reduce((sum, n) => sum + n, 0);
  return statuses <= row.total && latencies <= row.total;
}

export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES)
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(JSON.parse(text));
    if (!result.success) throw new Error("invalid");
    parsed = result.data;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const now = Date.now();
  if (!parsed.rows.every((row) => plausible(row, now)))
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const rows: BucketDelta[] = parsed.rows.map((row) => ({
    at: new Date(row.at).toISOString(),
    scope: row.scope,
    total: row.total,
    s2xx: row.s2xx,
    s3xx: row.s3xx,
    s401: row.s401,
    s403: row.s403,
    s429: row.s429,
    s4xxOther: row.s4xxOther,
    s5xx: row.s5xx,
    lat: row.lat,
  }));
  try {
    await getReliabilityStore().addBuckets(rows);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "tradecatch.monitoring.ingest_failed",
        code: safeDatabaseErrorCode(error) ?? "UNKNOWN",
      }),
    );
    return NextResponse.json(
      { ok: false, error: "storage_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, accepted: rows.length },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
