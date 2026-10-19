import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { safeErrorResponse } from "@/lib/api-error";
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
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: "Demo business not found." },
        { status: 404 },
      );
    }
    return safeErrorResponse(error, {
      route: "admin.demo-businesses.seed",
      request,
      fallback: "Seed failed.",
    });
  }
}
