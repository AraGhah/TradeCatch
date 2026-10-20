import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const url = new URL(request.url);
  const errors = await getReliabilityService().listErrors({
    organizationId: url.searchParams.get("business") || undefined,
    service: url.searchParams.get("service") || undefined,
  });
  return NextResponse.json({ ok: true, errors });
}
