import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listSalesLeads } from "@/product/sales-crm/service";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const params = z
  .object({ page: z.coerce.number().int().min(1).max(1000).default(1) })
  .strict();

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status, headers },
    );
  const parsed = params.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid sales lead page." },
      { status: 400, headers },
    );
  try {
    return NextResponse.json(
      { ok: true, ...(await listSalesLeads(parsed.data.page)) },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Sales leads are temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
