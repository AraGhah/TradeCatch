import { orgHasFeature } from "@/product/saas/entitlements";
import type { Organization } from "@/product/saas/types";
import {
  buildDashboardOverview,
  resolveDashboardRange,
  safeTimeZone,
  type DashboardAppointmentInput,
  type DashboardCallInput,
  type DashboardCrmLeadInput,
  type DashboardNoticeInput,
  type DashboardOverview,
  type DashboardRecoveryInput,
} from "@/product/saas/dashboard-overview";

const CALL_LIMIT = 500;
const LEAD_LIMIT = 200;

export async function loadDashboardOverview(input: {
  organization: Organization;
  userId: string;
  range?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): Promise<DashboardOverview> {
  const now = input.now ?? new Date();
  const range = resolveDashboardRange({
    range: input.range,
    from: input.from,
    to: input.to,
    now,
    timeZone: safeTimeZone(input.organization.timezone),
  });
  const organization = input.organization;
  const clientId = organization.missedCallClientId;

  const sources: DashboardOverview["sources"] = {
    calls: clientId ? "ready" : "unlinked",
    leads: "ready",
    recovery: clientId ? "ready" : "unlinked",
    appointments: "ready",
    revenue: orgHasFeature(organization.plan, "REVENUE_ATTRIBUTION") ? "ready" : "plan",
    notices: "ready",
    pipeline: orgHasFeature(organization.plan, "ADVANCED_ANALYTICS") ? "ready" : "plan",
    reviews: orgHasFeature(organization.plan, "REVIEW_AUTOMATION") ? "ready" : "plan",
  };

  const [callsResult, leadsResult, recoveryResult, appointmentsResult, growthResult, noticesResult] =
    await Promise.all([
      loadCalls(clientId, range.previousFrom),
      loadLeads(organization.id, range.previousFrom, range.to),
      loadRecovery(clientId),
      loadAppointments(organization.id),
      loadGrowth(organization.id, organization.plan),
      loadNotices(organization.id, input.userId),
    ]);

  if (callsResult.status === "error") sources.calls = "error";
  if (leadsResult.status === "error") sources.leads = "error";
  if (recoveryResult.status === "error") sources.recovery = "error";
  if (appointmentsResult.status === "error") sources.appointments = "error";
  if (growthResult.revenueStatus === "error") sources.revenue = "error";
  if (growthResult.pipelineStatus === "error") sources.pipeline = "error";
  if (growthResult.reviewStatus === "error") sources.reviews = "error";
  if (noticesResult.status === "error") sources.notices = "error";

  return buildDashboardOverview({
    now,
    range,
    calls: sources.calls === "ready" ? callsResult.rows : null,
    leads: sources.leads === "ready" ? leadsResult.rows : null,
    recovery: sources.recovery === "ready" ? recoveryResult.rows : null,
    appointments: sources.appointments === "ready" ? appointmentsResult.rows : null,
    revenue: sources.revenue === "ready" ? growthResult.revenue : null,
    notices: sources.notices === "ready" ? noticesResult.rows : null,
    pipeline: sources.pipeline === "ready" ? growthResult.pipeline : null,
    reviews: sources.reviews === "ready" ? growthResult.reviews : null,
    sources,
    truncated: {
      calls: callsResult.truncated,
      leads: leadsResult.truncated,
    },
  });
}

async function loadCalls(
  clientId: string | null,
  previousFrom: string,
): Promise<{
  status: "ready" | "unlinked" | "error";
  rows: DashboardCallInput[];
  truncated: boolean;
}> {
  if (!clientId) return { status: "unlinked", rows: [], truncated: false };
  try {
    const { getReceptionistRuntime } = await import("@/product/receptionist/runtime");
    const sessions = await getReceptionistRuntime().store.listSessions({
      clientAccountId: clientId,
      limit: CALL_LIMIT,
    });
    const oldest = sessions.at(-1)?.startedAt;
    const truncated =
      sessions.length >= CALL_LIMIT &&
      Boolean(oldest) &&
      Date.parse(oldest!) > Date.parse(previousFrom);
    return {
      status: "ready",
      truncated,
      rows: sessions.map((call) => ({
        id: call.id,
        fromE164: call.fromE164,
        startedAt: call.startedAt,
        status: call.status,
        outcome: call.outcome,
        durationSeconds: call.durationSeconds,
        recordingUrl: call.recordingUrl,
        transcriptPurgedAt: call.transcriptPurgedAt,
        callerName: call.slots.callerName || call.summary?.callerName,
        issue: call.slots.issue || call.summary?.issue,
        intent: call.intent,
        urgency: call.urgency?.level,
        aiSummary: call.summary?.aiSummary,
        headline: call.summary?.headline,
        nextStep: call.summary?.nextStep,
        transfersCompleted: call.transfers.filter((transfer) => transfer.status === "completed")
          .length,
        turns: call.turns
          .filter((turn) => turn.speaker === "caller" || turn.speaker === "agent")
          .slice(-12)
          .map((turn) => ({
            speaker: turn.speaker as "caller" | "agent",
            text: turn.text,
          })),
      })),
    };
  } catch {
    return { status: "error", rows: [], truncated: false };
  }
}

async function loadLeads(
  organizationId: string,
  from: string,
  to: string,
): Promise<{ status: "ready" | "error"; rows: DashboardCrmLeadInput[]; truncated: boolean }> {
  try {
    const { getCrmService } = await import("@/product/crm/runtime");
    const rows = await getCrmService().listLeads(organizationId, {
      from,
      to,
      limit: LEAD_LIMIT,
    });
    return {
      status: "ready",
      truncated: rows.length >= LEAD_LIMIT,
      rows: rows.map((lead) => ({
        id: lead.id,
        name:
          lead.customer.displayName?.trim() ||
          [lead.customer.firstName, lead.customer.lastName].filter(Boolean).join(" ") ||
          lead.customer.phoneE164,
        phone: lead.customer.phoneE164,
        status: lead.status,
        source: lead.source,
        service: lead.service,
        createdAt: lead.createdAt,
        missedCallLeadId: lead.missedCallLeadId,
      })),
    };
  } catch {
    return { status: "error", rows: [], truncated: false };
  }
}

async function loadRecovery(clientId: string | null): Promise<{
  status: "ready" | "unlinked" | "error";
  rows: DashboardRecoveryInput[];
}> {
  if (!clientId) return { status: "unlinked", rows: [] };
  try {
    const { ensureMissedCallReady } = await import("@/product/missed-call/runtime");
    const { store } = await ensureMissedCallReady();
    const leads = await store.listLeads(clientId);
    return {
      status: "ready",
      rows: leads
        .filter((lead) => lead.clientAccountId === clientId)
        .map((lead) => ({
          id: lead.id,
          name: lead.customerName?.trim() || lead.callerE164,
          createdAt: lead.createdAt,
          jobAccepted: lead.jobAccepted,
          becameBooking: lead.becameBooking,
          outcome: lead.outcome,
          estimatedValue: lead.estimatedValue,
          finalValue: lead.finalValue,
          technicianResponseMs: lead.technicianResponseMs,
          replied: lead.conversation.some(
            (message) => message.direction === "inbound" || message.actor === "customer",
          ),
          humanReview: lead.humanReviewRequired || lead.outcome === "human_review",
        })),
    };
  } catch {
    return { status: "error", rows: [] };
  }
}

async function loadAppointments(organizationId: string): Promise<{
  status: "ready" | "error";
  rows: DashboardAppointmentInput[];
}> {
  try {
    const { getSchedulingStore } = await import("@/product/scheduling/runtime");
    const rows = await getSchedulingStore().listAppointments(organizationId);
    return {
      status: "ready",
      rows: rows
        .filter((row) => row.organizationId === organizationId)
        .map((row) => ({
          id: row.id,
          customerName: row.customerName,
          serviceName: row.serviceName,
          startAt: row.startAt,
          endAt: row.endAt,
          status: row.status,
          bookingSource: row.bookingSource,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          serviceAddress: row.serviceAddress,
        })),
    };
  } catch {
    return { status: "error", rows: [] };
  }
}

async function loadGrowth(organizationId: string, plan: Organization["plan"]) {
  const empty = {
    revenue: [] as { amount: number; occurredAt: string }[],
    pipeline: [] as { stage: string; estimatedValue?: number }[],
    reviews: [] as { status: string; sentAt?: string; createdAt: string }[],
    revenueStatus: orgHasFeature(plan, "REVENUE_ATTRIBUTION") ? "ready" : "plan",
    pipelineStatus: orgHasFeature(plan, "ADVANCED_ANALYTICS") ? "ready" : "plan",
    reviewStatus: orgHasFeature(plan, "REVIEW_AUTOMATION") ? "ready" : "plan",
  } as const;
  if (empty.revenueStatus === "plan" && empty.pipelineStatus === "plan" && empty.reviewStatus === "plan") {
    return {
      revenue: null,
      pipeline: null,
      reviews: null,
      revenueStatus: "plan" as const,
      pipelineStatus: "plan" as const,
      reviewStatus: "plan" as const,
    };
  }
  try {
    const { getGrowthStore } = await import("@/product/growth");
    const store = getGrowthStore();
    const [revenue, pipeline, reviews] = await Promise.all([
      empty.revenueStatus === "ready" ? store.listRevenue(organizationId) : Promise.resolve([]),
      empty.pipelineStatus === "ready" ? store.listPipeline(organizationId) : Promise.resolve([]),
      empty.reviewStatus === "ready" ? store.listReviewRequests(organizationId) : Promise.resolve([]),
    ]);
    return {
      revenue:
        empty.revenueStatus === "ready"
          ? revenue
              .filter((row) => row.organizationId === organizationId)
              .map((row) => ({ amount: row.amount, occurredAt: row.occurredAt }))
          : null,
      pipeline:
        empty.pipelineStatus === "ready"
          ? pipeline
              .filter((row) => row.organizationId === organizationId)
              .map((row) => ({ stage: row.stage, estimatedValue: row.estimatedValue }))
          : null,
      reviews:
        empty.reviewStatus === "ready"
          ? reviews
              .filter((row) => row.organizationId === organizationId)
              .map((row) => ({
                status: row.status,
                sentAt: row.sentAt,
                createdAt: row.createdAt,
              }))
          : null,
      revenueStatus: "ready" as const,
      pipelineStatus: empty.pipelineStatus === "ready" ? ("ready" as const) : ("plan" as const),
      reviewStatus: empty.reviewStatus === "ready" ? ("ready" as const) : ("plan" as const),
    };
  } catch {
    return {
      revenue: null,
      pipeline: null,
      reviews: null,
      revenueStatus: empty.revenueStatus === "ready" ? ("error" as const) : ("plan" as const),
      pipelineStatus: empty.pipelineStatus === "ready" ? ("error" as const) : ("plan" as const),
      reviewStatus: empty.reviewStatus === "ready" ? ("error" as const) : ("plan" as const),
    };
  }
}

async function loadNotices(
  organizationId: string,
  userId: string,
): Promise<{ status: "ready" | "error"; rows: DashboardNoticeInput[] }> {
  try {
    const { getNotificationService } = await import("@/product/notifications/runtime");
    const rows = await getNotificationService().listForUser(organizationId, userId);
    return {
      status: "ready",
      rows: rows.map((row) => ({
        id: row.note.id,
        type: row.note.type,
        title: row.note.title,
        message: row.note.message,
        priority: row.note.priority,
        href: row.note.href,
        createdAt: row.note.createdAt,
        unread: !row.recipient?.readAt,
      })),
    };
  } catch {
    return { status: "error", rows: [] };
  }
}
