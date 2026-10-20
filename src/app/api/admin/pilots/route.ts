import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { safeErrorResponse } from "@/lib/api-error";
import { LaunchError } from "@/product/launch/service";
import { getLaunchService } from "@/product/launch/runtime";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  organizationId: z.string().min(1),
  businessName: z.string().min(1).max(120),
  industry: z.string().max(80).optional(),
  contactName: z.string().min(1).max(120),
  contactEmail: z.string().email(),
  phoneE164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional(),
  accountType: z.enum(["live", "demo"]),
});

export async function GET(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  return NextResponse.json({
    ok: true,
    pilots: await getLaunchService().list(),
  });
}

export async function POST(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid pilot." }, { status: 400 });
  try {
    const pilot = await getLaunchService().createPilot(parsed.data);
    return NextResponse.json({ ok: true, pilot });
  } catch (error) {
    return safeErrorResponse(error, {
      route: "admin.pilots.create",
      request,
      publicErrors: [LaunchError],
      fallback: "Failed.",
    });
  }
}
