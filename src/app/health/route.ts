import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness only. Does not call the database or any external provider. */
export async function GET() {
  return NextResponse.json(
    { service: "tradecatch-api", status: "healthy" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
