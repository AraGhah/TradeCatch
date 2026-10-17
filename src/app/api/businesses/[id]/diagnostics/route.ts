import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameBusiness } from "@/product/security/access";
import { SupportError } from "@/product/support/errors";
import { diagnosticSnapshot, findingsForCheck } from "@/product/support/diagnostics";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  check: z.enum(["ai", "phone", "calendar", "notifications", "sms", "automations", "subscription", "all"]).default("all"),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => ({ check: "all" })));
  if (!parsed.success) return NextResponse.json({ error: "Invalid check." }, { status: 400 });
  try {
    const report = await diagnosticSnapshot(id);
    return NextResponse.json({
      ok: true,
      check: parsed.data.check,
      scope: report.scope,
      liveVerified: report.liveVerified,
      plan: report.plan,
      recentErrorCount: report.recentErrorCount,
      findings: findingsForCheck(parsed.data.check, report.findings),
    });
  } catch (error) {
    const status = error instanceof SupportError ? error.status : 500;
    return NextResponse.json({ error: "Diagnostics failed." }, { status });
  }
}
