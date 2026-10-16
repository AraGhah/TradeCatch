import { NextResponse } from "next/server";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { AutomationError } from "@/product/sms-automation/service";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; automationId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id, automationId } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    const result = await getAutomationServices().deactivate(id, automationId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AutomationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
