import { NextRequest, NextResponse } from "next/server";
import { searchHelp } from "@/product/support/help";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "fr" ? "fr" : "en";
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ ok: true, articles: searchHelp(query, locale) });
}
