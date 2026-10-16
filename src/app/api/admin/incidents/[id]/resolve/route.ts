import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { ReliabilityError } from "@/product/reliability/service";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await params;
  try {
    const incident = await getReliabilityService().resolve(id, access.via);
    return NextResponse.json({ ok: true, incident });
  } catch (error) {
    const status = error instanceof ReliabilityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status });
  }
}
