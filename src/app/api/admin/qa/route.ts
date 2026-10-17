import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getQaService } from "@/product/qa/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const qa = getQaService();
  return NextResponse.json({ ok: true, suites: qa.catalog(), runs: await qa.history() });
}

export async function POST(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = (await request.json().catch(() => ({}))) as { suite?: string };
  const suite = body.suite || "all";
  if (!getQaService().catalog().includes(suite)) {
    return NextResponse.json({ error: "Unknown suite." }, { status: 400 });
  }
  const run = await getQaService().run(suite);
  return NextResponse.json({ ok: run.status === "passed", run });
}
