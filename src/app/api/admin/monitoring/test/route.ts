import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  scenario: z.enum([
    "ai_timeout",
    "api_failure",
    "job_failure",
    "cost_threshold",
    "database_failure",
  ]),
  organizationId: z.string().optional(),
});

/** Authorized simulation. Never calls Twilio, Stripe, Google, or an AI provider. */
export async function POST(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid simulation." }, { status: 400 });
  const service = getReliabilityService();
  const organizationId = parsed.data.organizationId;
  if (parsed.data.scenario === "ai_timeout") {
    const error = await service.recordError({
      organizationId,
      service: "ai_receptionist",
      operation: "generate_response",
      errorCode: "AI_PROVIDER_TIMEOUT",
      severity: "high",
      retryable: true,
      detail: "simulated timeout",
      simulated: true,
    });
    return NextResponse.json({
      ok: true,
      simulated: true,
      errorId: error.id,
      requestId: error.requestId,
    });
  }
  if (parsed.data.scenario === "api_failure") {
    await service.recordRequest(500, 1200);
    const error = await service.recordError({
      organizationId,
      service: "api",
      operation: "request",
      errorCode: "SIMULATED_SERVER_ERROR",
      severity: "high",
      retryable: true,
      simulated: true,
    });
    return NextResponse.json({
      ok: true,
      simulated: true,
      errorId: error.id,
      requestId: error.requestId,
    });
  }
  if (parsed.data.scenario === "job_failure") {
    const operation = await service.recordFailedOperation({
      organizationId,
      service: "jobs",
      operation: "quote_reminder",
      idempotencyKey: `sim:${organizationId || "platform"}:quote`,
      retryable: true,
      error: "simulated temporary sms failure",
      simulated: true,
    });
    return NextResponse.json({
      ok: true,
      simulated: true,
      operationId: operation.id,
    });
  }
  if (parsed.data.scenario === "database_failure") {
    const result = service.databaseResult(false, { saved: true });
    const error = await service.recordError({
      organizationId,
      service: "database",
      operation: "write",
      errorCode: "DATABASE_UNAVAILABLE",
      severity: "critical",
      retryable: true,
      simulated: true,
    });
    return NextResponse.json({
      ok: true,
      simulated: true,
      write: result,
      errorId: error.id,
    });
  }
  const cost = await service.recordUsage({
    service: "ai",
    units: 100,
    centsPerUnit: 80,
    organizationId,
    simulated: true,
  });
  return NextResponse.json({ ok: true, simulated: true, cost });
}
