import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import {
  automationFailure,
  limitAutomationWrite,
} from "@/product/sms-automation/http";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; templateId: string }> };

const schema = z.object({
  body: z.string().max(1000).optional(),
  reset: z.boolean().optional(),
});

export async function PUT(request: NextRequest, { params }: Params) {
  const { id, templateId } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  const limited = await limitAutomationWrite(id, access.ctx.user.id);
  if (limited) return limited;
  let json: unknown;
  try {
    json = await readJsonBounded(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid template." }, { status: 400 });
  }
  try {
    const template = await getAutomationServices().updateTemplate(
      id,
      templateId,
      {
        body: parsed.data.body,
        reset: parsed.data.reset,
      },
    );
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    return automationFailure(err, "template");
  }
}
