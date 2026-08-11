import type { LeadRecord } from "@/product/missed-call/types";

export type StarterDashboardMetrics = {
  leadsCaptured: number;
  missedCallsRecovered: number;
  leadsReplied: number;
  needsAttention: number;
  jobsAccepted: number;
  /** Only included when real values exist on leads — never fabricated. */
  estimatedPipelineValue: number | null;
};

/**
 * Conservative Starter metrics from Module A lead records.
 * Does not invent "recovered revenue".
 */
export function computeStarterDashboardMetrics(
  leads: LeadRecord[],
): StarterDashboardMetrics {
  let leadsReplied = 0;
  let needsAttention = 0;
  let jobsAccepted = 0;
  let valueSum = 0;
  let valueCount = 0;

  for (const lead of leads) {
    const customerMsgs = lead.conversation.filter(
      (m) => m.direction === "inbound" || m.actor === "customer",
    );
    if (customerMsgs.length > 0) leadsReplied += 1;
    if (lead.humanReviewRequired || lead.outcome === "human_review") {
      needsAttention += 1;
    }
    if (lead.jobAccepted || lead.outcome === "technician_accepted") {
      jobsAccepted += 1;
    }
    const amount = lead.finalValue ?? lead.estimatedValue;
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      valueSum += amount;
      valueCount += 1;
    }
  }

  return {
    leadsCaptured: leads.length,
    missedCallsRecovered: leads.length,
    leadsReplied,
    needsAttention,
    jobsAccepted,
    estimatedPipelineValue: valueCount > 0 ? valueSum : null,
  };
}
