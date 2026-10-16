import { NextResponse } from "next/server";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireAutomationAccess(id, "read");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const jobs = await getAutomationServices().listJobs(id);
  return NextResponse.json({ ok: true, jobs });
}
