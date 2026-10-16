import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";

async function guard(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return { access, response: NextResponse.json({ error: access.error }, { status: access.status }) };
  return { access, response: null };
}

export async function GET(request: Request) {
  const gate = await guard(request);
  if (gate.response) return gate.response;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "overview";
  const service = getReliabilityService();
  if (view === "errors") {
    return NextResponse.json({ ok: true, errors: await service.listErrors({ service: url.searchParams.get("service") || undefined }) });
  }
  if (view === "jobs") return NextResponse.json({ ok: true, jobs: await service.jobs() });
  if (view === "costs") return NextResponse.json({ ok: true, costs: await service.costs() });
  if (view === "calls") {
    const errors = await service.listErrors({ service: "ai_receptionist" });
    return NextResponse.json({ ok: true, failedCalls: errors.length, errors });
  }
  if (view === "integrations") {
    const overview = await service.overview();
    return NextResponse.json({ ok: true, services: overview.services });
  }
  const overview = await service.overview();
  return NextResponse.json({ ok: true, ...overview });
}
