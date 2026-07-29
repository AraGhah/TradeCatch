import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { applyManualCorrection } from "@/product/missed-call/crm";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  field: z.enum([
    "customerName",
    "serviceAddress",
    "issueDescription",
    "serviceAreaFlagged",
    "jobAccepted",
    "becameBooking",
    "estimatedValue",
    "finalValue",
    "outcome",
  ]),
  value: z.union([
    z.string(),
    z.boolean(),
    z.number(),
    z.enum([
      "open",
      "technician_accepted",
      "technician_declined",
      "customer_unreachable",
      "resolved",
      "cancelled",
      "human_review",
    ]),
  ]),
  note: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  const { id } = await context.params;
  const { store } = await ensureMissedCallReady();
  const lead = await store.getLead(id);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lead });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  const sandboxOk =
    process.env.MISSED_CALL_SANDBOX === "1" ||
    process.env.NODE_ENV !== "production";
  if (!sandboxOk) {
    return NextResponse.json({ error: "Corrections disabled" }, { status: 403 });
  }

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { store } = await ensureMissedCallReady();
  const lead = await store.getLead(id);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const ok = applyManualCorrection(
    lead,
    parsed.data.field,
    parsed.data.value,
    parsed.data.note,
  );
  if (!ok) {
    return NextResponse.json({ error: "Field not allowed" }, { status: 400 });
  }
  await store.saveLead(lead);
  return NextResponse.json({ ok: true, lead });
}
