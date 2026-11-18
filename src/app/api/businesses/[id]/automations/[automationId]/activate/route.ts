import { NextResponse } from "next/server";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import {
  automationFailure,
  limitAutomationWrite,
} from "@/product/sms-automation/http";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; automationId: string }> };

/** Turns the automation on. Repeating it changes nothing: it sets "on", it does not toggle. */
export async function POST(_request: Request, { params }: Params) {
  const { id, automationId } = await params;
  const access = await requireAutomationAccess(id, "write");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  const limited = await limitAutomationWrite(id, access.ctx.user.id);
  if (limited) return limited;
  try {
    const automation = await getAutomationServices().activate(id, automationId);
    return NextResponse.json({ ok: true, automation });
  } catch (err) {
    return automationFailure(err, "activate");
  }
}
