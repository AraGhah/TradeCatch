import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { safeErrorResponse } from "@/lib/api-error";
import { ReliabilityError } from "@/product/reliability/service";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await params;
  try {
    const incident = await getReliabilityService().acknowledge(id, access.via);
    return NextResponse.json({ ok: true, incident });
  } catch (error) {
    return safeErrorResponse(error, {
      route: "admin.incidents.acknowledge",
      request,
      publicErrors: [ReliabilityError],
      fallback: "Failed.",
    });
  }
}
