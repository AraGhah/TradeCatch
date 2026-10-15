import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRealProductionRuntime, isStagingRuntime } from "@/lib/environment";
import {
  authorizeOpsRequest,
  getOpsSecret,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import {
  DEMO_RESET_CONFIRMATION,
  resetDemoData,
} from "@/product/demo/reset-demo-data";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    confirm: z.literal(DEMO_RESET_CONFIRMATION),
  })
  .strict();

/**
 * Staging-only: wipe demo tables and re-seed the fictional client.
 * Never available on the live production deployment.
 */
export async function POST(request: NextRequest) {
  if (isRealProductionRuntime()) {
    return NextResponse.json(
      { error: "Demo reset is not available in production." },
      { status: 404 },
    );
  }

  // Staging builds (NODE_ENV=production + TRADECATCH_ENV=staging) and local
  // development may reset. Refuse ambiguous production-like hosts that are
  // not explicitly marked staging.
  if (
    process.env.NODE_ENV === "production" &&
    !isStagingRuntime() &&
    process.env.TRADECATCH_ALLOW_DEMO_RESET !== "1"
  ) {
    return NextResponse.json(
      {
        error:
          "Demo reset requires TRADECATCH_ENV=staging (or TRADECATCH_ALLOW_DEMO_RESET=1 for disposable hosts).",
      },
      { status: 403 },
    );
  }

  if (!getOpsSecret() || !authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  const audit = logOpsAccess(request, "ops.demo_reset");
  if (!request.headers.get("x-ops-actor")?.trim() || audit.missingActor) {
    return missingOpsActorResponse();
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `Invalid payload. Send { "confirm": "${DEMO_RESET_CONFIRMATION}" }.`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await resetDemoData();
    logOpsAccess(request, "ops.demo_reset.completed", {
      mode: result.mode,
      seededClientId: result.seededClientId,
      truncated: result.truncatedTables.length,
    });
    return NextResponse.json({
      environment: "staging",
      ...result,
    });
  } catch (error) {
    console.error("[ops/demo/reset]", error);
    return NextResponse.json(
      { error: "Failed to reset demo data." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (isRealProductionRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  return NextResponse.json({
    ok: true,
    endpoint: "/api/ops/demo/reset",
    method: "POST",
    confirm: DEMO_RESET_CONFIRMATION,
    note: "Staging / disposable hosts only. Never runs against production.",
  });
}
