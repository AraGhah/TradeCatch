import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const { id } = await params;
  const incidents = await getReliabilityService().listIncidents();
  const incident = incidents.find((row) => row.id === id) ?? null;
  if (!incident)
    return NextResponse.json({ error: "Incident not found." }, { status: 404 });
  return NextResponse.json({ ok: true, incident });
}
