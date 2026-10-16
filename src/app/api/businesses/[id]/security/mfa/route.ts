import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SecurityError } from "@/product/security/service";
import { getSecurityService } from "@/product/security/runtime";
import { requireSameBusiness } from "@/product/security/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.ctx.isPlatformAdmin && access.ctx.user.platformRole !== "admin") {
    return NextResponse.json({ error: "MFA enrollment is limited to administrators." }, { status: 403 });
  }
  const service = getSecurityService();
  if (request.headers.get("content-type")?.includes("json")) {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid authentication code." }, { status: 400 });
    try {
      const result = await service.confirmMfa(access.ctx.user.id, access.ctx.session.id, parsed.data.code);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const status = error instanceof SecurityError ? error.status : 500;
      return NextResponse.json({ error: "Invalid authentication code." }, { status });
    }
  }
  const enrolled = await service.enrollMfa(access.ctx.user.id);
  return NextResponse.json({ ok: true, otpauth: enrolled.otpauth });
}
