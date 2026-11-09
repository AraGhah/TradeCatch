import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import {
  createPostgresOverageInvoicingDeps,
  overageInvoicingSettings,
  runOverageInvoicing,
} from "@/product/saas/overage-invoicing";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * Bills last month's owner-confirmed overage to Stripe as pending invoice items.
 * Ops only, and a no-op unless OVERAGE_INVOICING=1 with both rates configured
 * (see overage-invoicing.ts). Safe to call repeatedly: a month is billed once.
 */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "billing.overage_invoices.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }

  const settings = overageInvoicingSettings();
  if (!settings.enabled) {
    // Off: touch nothing, not even the database.
    return NextResponse.json(
      { ok: true, enabled: false, reason: settings.reason },
      { headers: privateHeaders },
    );
  }
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: privateHeaders },
    );
  }
  const result = await runOverageInvoicing(
    createPostgresOverageInvoicingDeps(url, new Date(), settings),
  );
  return NextResponse.json(
    { ok: true, ...result },
    { headers: privateHeaders },
  );
}

export const GET = tick;
export const POST = tick;
