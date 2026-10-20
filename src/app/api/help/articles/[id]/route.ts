import { NextRequest, NextResponse } from "next/server";
import { getHelpArticle } from "@/product/support/help";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const locale =
    request.nextUrl.searchParams.get("locale") === "fr" ? "fr" : "en";
  const article = getHelpArticle(id, locale);
  if (!article)
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
  return NextResponse.json({ ok: true, article });
}
