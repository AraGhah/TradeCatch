import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { SecurityError } from "@/product/security/service";
import { getSecurityService } from "@/product/security/runtime";
import { requireSameBusiness } from "@/product/security/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Administrator second factor.
 *  - JSON body `{ code }`  → confirm enrollment, or verify this session.
 *  - no body               → start enrollment (refused once MFA is enabled).
 * Only people on the administrator list may use it; the check is on identity
 * (not on the already-verified flag) because an administrator must be able to
 * reach this route in order to become verified.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.ctx.isPlatformAdminIdentity) {
    return NextResponse.json({ error: "MFA enrollment is limited to administrators." }, { status: 403 });
  }

  const budget = await rateLimitAsync({
    key: `admin-mfa:${access.ctx.user.id}:${getClientIp(request)}`,
    limit: 20,
    windowMs: 15 * 60_000,
  });
  if (!budget.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: NO_STORE });
  }

  const service = getSecurityService();
  if (request.headers.get("content-type")?.includes("json")) {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid authentication code." }, { status: 400, headers: NO_STORE });
    }
    try {
      const result = await service.confirmMfa(access.ctx.user.id, access.ctx.session.id, parsed.data.code);
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof SecurityError) {
        return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
      }
      console.error("[mfa] confirm failed", error);
      return NextResponse.json({ error: "Verification failed." }, { status: 500, headers: NO_STORE });
    }
  }

  try {
    const enrolled = await service.enrollMfa(access.ctx.user.id);
    return NextResponse.json(
      { ok: true, otpauth: enrolled.otpauth, secret: enrolled.secret },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof SecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    console.error("[mfa] enroll failed", error);
    return NextResponse.json({ error: "Enrollment failed." }, { status: 500, headers: NO_STORE });
  }
}
