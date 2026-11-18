import { readJsonBounded } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { automationFailure } from "@/product/sms-automation/http";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import { AUTOMATION_TYPES } from "@/product/sms-automation/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  type: z.enum(AUTOMATION_TYPES),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireAutomationAccess(id, "read");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  try {
    const automations = await getAutomationServices().list(id);
    return NextResponse.json({ ok: true, automations });
  } catch (err) {
    return automationFailure(err, "list");
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  let json: unknown;
  try {
    json = await readJsonBounded(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid automation type." },
      { status: 400 },
    );
  }
  try {
    const automations = await getAutomationServices().list(id);
    const automation = automations.find((row) => row.type === parsed.data.type);
    return NextResponse.json({ ok: true, automation });
  } catch (err) {
    return automationFailure(err, "list");
  }
}
