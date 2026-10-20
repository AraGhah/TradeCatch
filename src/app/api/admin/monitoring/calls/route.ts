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
  const service = getReliabilityService();
  const overview = await service.overview();
  const ai = overview.services.find((row) => row.service === "ai_receptionist");
  const errors = await service.listErrors({ service: "ai_receptionist" });
  return NextResponse.json({
    ok: true,
    ai,
    failedCalls: errors.length,
    errors,
  });
}
