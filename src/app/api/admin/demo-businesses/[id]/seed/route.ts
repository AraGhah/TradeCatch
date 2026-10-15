import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { seedDemoBusiness } from "@/product/demo/business-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const summary = await seedDemoBusiness(id);
    return NextResponse.json({
      ok: true,
      simulated: true,
      summary,
      note: "All generated records are fictional. No real customers were contacted.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seed failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
