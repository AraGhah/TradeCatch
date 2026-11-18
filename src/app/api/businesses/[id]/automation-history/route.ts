import { NextResponse } from "next/server";
import { requireAutomationAccess } from "@/product/sms-automation/access";
import { automationFailure } from "@/product/sms-automation/http";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The messages the automations handled. `?executions=1` adds the execution log: one row
 * for every attempt, skip, retry and failure, with the reason and the time, for
 * troubleshooting ("why did this customer not get a text?").
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireAutomationAccess(id, "read");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  try {
    const services = getAutomationServices();
    const history = await services.history(id);
    const withExecutions =
      new URL(request.url).searchParams.get("executions") === "1";
    return NextResponse.json({
      ok: true,
      history,
      ...(withExecutions ? { executions: await services.executions(id) } : {}),
    });
  } catch (err) {
    return automationFailure(err, "history");
  }
}
