import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { getGrowthServices } from "@/product/growth";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "growth.crm.tick");
  if (refusal) return refusal;

  const result = await getGrowthServices().processCrmDlq();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
