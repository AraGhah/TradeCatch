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
    const operation = await getReliabilityService().retryOperation(id, access.via);
    return NextResponse.json({ ok: true, operation, duplicateCustomerMessage: false });
  } catch (error) {
    return safeErrorResponse(error, {
      route: "admin.recovery.retry",
      request,
      publicErrors: [ReliabilityError],
      fallback: "Retry failed.",
    });
  }
}
