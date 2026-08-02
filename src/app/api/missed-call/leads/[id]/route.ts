import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
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
  const audit = logOpsAccess(request, "leads.get");
  if (audit.missingActor) {
    return missingOpsActorResponse();
  }

  const { id } = await context.params;
  const { store } = await ensureMissedCallReady();
  const lead = await store.getLead(id);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  logOpsAccess(request, "leads.get.ok", { leadId: id });
  return NextResponse.json({ ok: true, lead });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "leads.patch");
  if (audit.missingActor) {
    return missingOpsActorResponse();
  }

  // Production corrections use a dedicated flag — do not couple to sandbox
  // traffic injection (MISSED_CALL_SANDBOX).
  const correctionsOk =
    process.env.MISSED_CALL_ALLOW_CORRECTIONS === "1" ||
    process.env.NODE_ENV !== "production";
  if (!correctionsOk) {
    return NextResponse.json(
      { error: "Corrections disabled" },
      { status: 403 },
    );
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
  logOpsAccess(request, "leads.patch.ok", {
    leadId: id,
    field: parsed.data.field,
  });
  return NextResponse.json({ ok: true, lead });
}
