import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { AutomationError } from "@/product/sms-automation/service";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import { TEMPLATE_KEYS } from "@/product/sms-automation/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const previewSchema = z.object({
  action: z.literal("preview"),
  templateKey: z.enum(TEMPLATE_KEYS),
  locale: z.enum(["en", "fr"]),
  body: z.string().max(1000).optional(),
  vars: z.record(z.string(), z.string()).optional(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireAutomationAccess(id, "read");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const templates = await getAutomationServices().listTemplates(id);
  return NextResponse.json({ ok: true, templates });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireAutomationAccess(id, "read");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = previewSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preview." }, { status: 400 });
  }
  try {
    const preview = await getAutomationServices().preview({
      organizationId: id,
      templateKey: parsed.data.templateKey,
      locale: parsed.data.locale,
      body: parsed.data.body,
      vars: parsed.data.vars,
    });
    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    if (err instanceof AutomationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
