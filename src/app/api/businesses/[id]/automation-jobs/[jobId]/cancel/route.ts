import { NextResponse } from "next/server";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import {
  automationFailure,
  limitAutomationWrite,
} from "@/product/sms-automation/http";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id, jobId } = await params;
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
    const job = await getAutomationServices().cancelJob(id, jobId);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    return automationFailure(err, "job-cancel");
  }
}
