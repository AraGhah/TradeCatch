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
  const deployments = await getReliabilityService().listDeployments();
  return NextResponse.json({
    ok: true,
    deployments,
    note: "Rolling back a Worker does not undo database migrations.",
  });
}
