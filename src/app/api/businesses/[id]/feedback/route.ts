import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameBusiness } from "@/product/security/access";
import { getLaunchService } from "@/product/launch/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  category: z.enum(["ai", "calls", "sms", "dashboard", "appointments"]),
  description: z.string().min(3).max(1000),
  priority: z.enum(["low", "medium", "high", "critical"]),
  reference: z.string().max(80).optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.ctx.membership.role === "viewer") return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
  const feedback = await getLaunchService().addFeedback({ organizationId: id, ...parsed.data });
  return NextResponse.json({ ok: true, feedback: { id: feedback.id, status: feedback.status } });
}
