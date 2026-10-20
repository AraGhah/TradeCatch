import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { safeErrorResponse } from "@/lib/api-error";
import { LaunchError } from "@/product/launch/service";
import { currentReadiness, getLaunchService } from "@/product/launch/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const { id } = await params;
  const service = getLaunchService();
  const pilot = await service.get(id);
  if (!pilot)
    return NextResponse.json({ error: "Pilot not found." }, { status: 404 });
  const view = new URL(request.url).searchParams.get("view");
  if (view === "activity")
    return NextResponse.json({
      ok: true,
      activity: await service.activity(pilot.organizationId),
    });
  if (view === "report")
    return NextResponse.json({ ok: true, report: await service.report(id) });
  if (view === "feedback")
    return NextResponse.json({
      ok: true,
      feedback: await service.feedback(pilot.organizationId),
    });
  return NextResponse.json({ ok: true, pilot, tests: await service.tests(id) });
}

const testSchema = z.object({
  scenario: z.string(),
  status: z.enum(["passed", "failed"]),
  note: z.string().max(240).optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const { id } = await params;
  const action = new URL(request.url).searchParams.get("action");
  const service = getLaunchService();
  try {
    if (action === "activate") {
      const readiness = await currentReadiness();
      return NextResponse.json({
        ok: true,
        pilot: await service.activate(id, readiness.overall),
      });
    }
    if (action === "leave")
      return NextResponse.json({ ok: true, pilot: await service.leave(id) });
    const parsed = testSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid live test result." },
        { status: 400 },
      );
    return NextResponse.json({
      ok: true,
      test: await service.recordTest(
        id,
        parsed.data.scenario,
        parsed.data.status,
        parsed.data.note,
      ),
    });
  } catch (error) {
    return safeErrorResponse(error, {
      route: "admin.pilots.update",
      request,
      publicErrors: [LaunchError],
      fallback: "Failed.",
    });
  }
}
