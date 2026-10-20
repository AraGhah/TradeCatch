import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { currentReadiness } from "@/product/launch/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  return NextResponse.json({ ok: true, ...(await currentReadiness()) });
}
