import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { safeErrorResponse } from "@/lib/api-error";
import { resetDemoBusiness } from "@/product/demo/business-service";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    confirm: z.literal("RESET_DEMO_ACCOUNT"),
    reseed: z.boolean().optional().default(false),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Send { "confirm": "RESET_DEMO_ACCOUNT", "reseed": true|false }.',
      },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const result = await resetDemoBusiness(id, {
      reseed: parsed.data.reseed,
    });
    return NextResponse.json({
      ...result,
      note: "Owner access retained. Only this demo business was reset.",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: "Demo business not found." },
        { status: 404 },
      );
    }
    return safeErrorResponse(error, {
      route: "admin.demo-businesses.reset",
      request,
      fallback: "Reset failed.",
    });
  }
}
