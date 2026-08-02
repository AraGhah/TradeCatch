import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "leads.list");
  if (audit.missingActor) {
    return missingOpsActorResponse();
  }

  const clientId =
    request.nextUrl.searchParams.get("clientAccountId")?.trim() ||
    process.env.MISSED_CALL_CLIENT_ID?.trim() ||
    "client_demo";

  const { store } = await ensureMissedCallReady();
  const leads = await store.listLeads(clientId);
  return NextResponse.json({
    ok: true,
    leads: leads.map((l) => ({
      id: l.id,
      workflowId: l.workflowId,
      callerE164: l.callerE164,
      customerName: l.customerName,
      serviceAddress: l.serviceAddress,
      issueDescription: l.issueDescription,
      serviceArea: l.serviceArea,
      serviceAreaFlagged: l.serviceAreaFlagged,
      urgency: l.urgency,
      humanReviewRequired: l.humanReviewRequired,
      techniciansAlerted: l.techniciansAlerted,
      technicianResponseMs: l.technicianResponseMs,
      jobAccepted: l.jobAccepted,
      becameBooking: l.becameBooking,
      estimatedValue: l.estimatedValue,
      finalValue: l.finalValue,
      outcome: l.outcome,
      conversationLength: l.conversation.length,
      manualCorrections: l.manualCorrections,
      updatedAt: l.updatedAt,
    })),
  });
}
