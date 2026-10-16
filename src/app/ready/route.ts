import { NextResponse } from "next/server";
import { getPgPool } from "@/product/missed-call/postgres-store";

export const dynamic = "force-dynamic";

/** Lightweight readiness. A missing database URL is reported; providers are not called. */
export async function GET() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return NextResponse.json(
      { service: "tradecatch-api", status: "ready", database: "not_configured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    await getPgPool(url).query("SELECT 1");
    return NextResponse.json(
      { service: "tradecatch-api", status: "ready", database: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { service: "tradecatch-api", status: "not_ready", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
