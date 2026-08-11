import { newId } from "@/product/saas/ids";
import {
  defaultOrgSettings,
  type OrgSettings,
  type QualificationQuestion,
} from "@/product/starter/qualification";

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type Appointment = {
  id: string;
  organizationId: string;
  customerName?: string;
  customerPhoneE164?: string;
  customerEmail?: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  status: AppointmentStatus;
  source: "manual" | "website" | "missed_call" | "quote";
  sourceRefId?: string;
  reminder24hSent: boolean;
  reminder2hSent: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type PipelineStage =
  | "new"
  | "contacted"
  | "qualified"
  | "quoted"
  | "booked"
  | "won"
  | "lost";

export type PipelineCard = {
  id: string;
  organizationId: string;
  stage: PipelineStage;
  title: string;
  source: "missed_call" | "website" | "quote" | "manual";
  sourceRefId?: string;
  customerPhoneE164?: string;
  estimatedValue?: number;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
};

export type RevenueEvent = {
  id: string;
  organizationId: string;
  amount: number;
  currency: string;
  source: "missed_call" | "website" | "quote" | "booking" | "manual";
  sourceRefId?: string;
  pipelineCardId?: string;
  note?: string;
  occurredAt: string;
  createdAt: string;
};

export type ReviewRequest = {
  id: string;
  organizationId: string;
  customerPhoneE164: string;
  customerName?: string;
  status: "pending" | "sent" | "clicked" | "skipped" | "failed";
  appointmentId?: string;
  scheduledFor: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TimelineEvent = {
  id: string;
  organizationId: string;
  kind: string;
  refId?: string;
  title: string;
  detail?: string;
  actor: string;
  at: string;
};

export type CrmDlqItem = {
  id: string;
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
  lastError?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  resolved?: boolean;
};

export type GrowthStore = {
  getOrgSettings(organizationId: string): Promise<OrgSettings>;
  upsertOrgSettings(
    organizationId: string,
    patch: Partial<
      Pick<
        OrgSettings,
        | "notifyEmail"
        | "googleReviewUrl"
        | "crmWebhookUrl"
        | "qualificationQuestions"
        | "onboardingCompletedAt"
        | "localeDefault"
      >
    >,
  ): Promise<OrgSettings>;

  createAppointment(
    input: Omit<
      Appointment,
      "id" | "createdAt" | "updatedAt" | "reminder24hSent" | "reminder2hSent"
    > & { id?: string },
  ): Promise<Appointment>;
  listAppointments(organizationId: string): Promise<Appointment[]>;
  getAppointment(
    id: string,
    organizationId: string,
  ): Promise<Appointment | null>;
  updateAppointment(
    id: string,
    organizationId: string,
    patch: Partial<Appointment>,
  ): Promise<Appointment | null>;
  listDueAppointmentReminders(nowIso: string): Promise<Appointment[]>;

  upsertPipelineCard(
    input: Omit<PipelineCard, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<PipelineCard>;
  listPipeline(organizationId: string): Promise<PipelineCard[]>;
  updatePipelineStage(
    id: string,
    organizationId: string,
    stage: PipelineStage,
    estimatedValue?: number,
  ): Promise<PipelineCard | null>;

  addRevenueEvent(
    input: Omit<RevenueEvent, "id" | "createdAt"> & { id?: string },
  ): Promise<RevenueEvent>;
  listRevenue(organizationId: string): Promise<RevenueEvent[]>;

  createReviewRequest(
    input: Omit<ReviewRequest, "id" | "createdAt" | "updatedAt" | "status"> & {
      id?: string;
      status?: ReviewRequest["status"];
    },
  ): Promise<ReviewRequest>;
  listReviewRequests(organizationId: string): Promise<ReviewRequest[]>;
  listDueReviewRequests(
    nowIso: string,
    limit: number,
  ): Promise<ReviewRequest[]>;
  updateReviewRequest(
    id: string,
    organizationId: string,
    patch: Partial<ReviewRequest>,
  ): Promise<ReviewRequest | null>;

  addTimelineEvent(
    input: Omit<TimelineEvent, "id"> & { id?: string },
  ): Promise<TimelineEvent>;
  listTimeline(
    organizationId: string,
    limit?: number,
  ): Promise<TimelineEvent[]>;

  enqueueCrmDlq(
    input: Omit<CrmDlqItem, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<CrmDlqItem>;
  listCrmDlq(organizationId: string, limit?: number): Promise<CrmDlqItem[]>;
  listDueCrmDlq(limit: number): Promise<CrmDlqItem[]>;
  updateCrmDlq(
    id: string,
    organizationId: string,
    patch: Partial<Pick<CrmDlqItem, "lastError" | "attempts" | "resolved">>,
  ): Promise<CrmDlqItem | null>;
};

function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return newId(prefix);
}

export function createMemoryGrowthStore(): GrowthStore {
  const settings = new Map<string, OrgSettings>();
  const appointments = new Map<string, Appointment>();
  const pipeline = new Map<string, PipelineCard>();
  const revenue = new Map<string, RevenueEvent>();
  const reviews = new Map<string, ReviewRequest>();
  const timeline = new Map<string, TimelineEvent>();
  const crmDlq = new Map<string, CrmDlqItem>();

  return {
    async getOrgSettings(organizationId) {
      return settings.get(organizationId) ?? defaultOrgSettings(organizationId);
    },

    async upsertOrgSettings(organizationId, patch) {
      const current =
        settings.get(organizationId) ?? defaultOrgSettings(organizationId);
      const next: OrgSettings = {
        ...current,
        ...patch,
        qualificationQuestions:
          patch.qualificationQuestions ?? current.qualificationQuestions,
        updatedAt: nowIso(),
      };
      settings.set(organizationId, next);
      return next;
    },

    async createAppointment(input) {
      const createdAt = nowIso();
      const row: Appointment = {
        id: input.id ?? createId("appt"),
        organizationId: input.organizationId,
        customerName: input.customerName,
        customerPhoneE164: input.customerPhoneE164,
        customerEmail: input.customerEmail,
        title: input.title,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: input.status,
        source: input.source,
        sourceRefId: input.sourceRefId,
        reminder24hSent: false,
        reminder2hSent: false,
        notes: input.notes,
        createdAt,
        updatedAt: createdAt,
      };
      appointments.set(row.id, row);
      return row;
    },

    async listAppointments(organizationId) {
      return [...appointments.values()]
        .filter((a) => a.organizationId === organizationId)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },

    async getAppointment(id, organizationId) {
      const a = appointments.get(id);
      if (!a || a.organizationId !== organizationId) return null;
      return a;
    },

    async updateAppointment(id, organizationId, patch) {
      const a = appointments.get(id);
      if (!a || a.organizationId !== organizationId) return null;
      const next = { ...a, ...patch, updatedAt: nowIso() };
      appointments.set(id, next);
      return next;
    },

    async listDueAppointmentReminders(now) {
      const t = Date.parse(now);
      return [...appointments.values()].filter((a) => {
        if (a.status !== "scheduled" && a.status !== "confirmed") return false;
        const start = Date.parse(a.startsAt);
        const h24 = start - 24 * 60 * 60 * 1000;
        const h2 = start - 2 * 60 * 60 * 1000;
        if (!a.reminder24hSent && t >= h24 && t < start) return true;
        if (!a.reminder2hSent && t >= h2 && t < start) return true;
        return false;
      });
    },

    async upsertPipelineCard(input) {
      if (input.sourceRefId) {
        for (const existing of pipeline.values()) {
          if (
            existing.organizationId === input.organizationId &&
            existing.source === input.source &&
            existing.sourceRefId === input.sourceRefId
          ) {
            const next = {
              ...existing,
              title: input.title,
              stage: input.stage,
              customerPhoneE164:
                input.customerPhoneE164 ?? existing.customerPhoneE164,
              estimatedValue: input.estimatedValue ?? existing.estimatedValue,
              updatedAt: nowIso(),
            };
            pipeline.set(existing.id, next);
            return next;
          }
        }
      }
      const createdAt = nowIso();
      const card: PipelineCard = {
        id: input.id ?? createId("pipe"),
        organizationId: input.organizationId,
        stage: input.stage,
        title: input.title,
        source: input.source,
        sourceRefId: input.sourceRefId,
        customerPhoneE164: input.customerPhoneE164,
        estimatedValue: input.estimatedValue,
        assignedTo: input.assignedTo,
        createdAt,
        updatedAt: createdAt,
      };
      pipeline.set(card.id, card);
      return card;
    },

    async listPipeline(organizationId) {
      return [...pipeline.values()]
        .filter((c) => c.organizationId === organizationId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async updatePipelineStage(id, organizationId, stage, estimatedValue) {
      const c = pipeline.get(id);
      if (!c || c.organizationId !== organizationId) return null;
      const next = {
        ...c,
        stage,
        estimatedValue: estimatedValue ?? c.estimatedValue,
        updatedAt: nowIso(),
      };
      pipeline.set(id, next);
      return next;
    },

    async addRevenueEvent(input) {
      const createdAt = nowIso();
      const row: RevenueEvent = {
        id: input.id ?? createId("rev"),
        organizationId: input.organizationId,
        amount: input.amount,
        currency: input.currency,
        source: input.source,
        sourceRefId: input.sourceRefId,
        pipelineCardId: input.pipelineCardId,
        note: input.note,
        occurredAt: input.occurredAt,
        createdAt,
      };
      revenue.set(row.id, row);
      return row;
    },

    async listRevenue(organizationId) {
      return [...revenue.values()]
        .filter((r) => r.organizationId === organizationId)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async createReviewRequest(input) {
      const createdAt = nowIso();
      const row: ReviewRequest = {
        id: input.id ?? createId("revq"),
        organizationId: input.organizationId,
        customerPhoneE164: input.customerPhoneE164,
        customerName: input.customerName,
        status: input.status ?? "pending",
        appointmentId: input.appointmentId,
        scheduledFor: input.scheduledFor,
        createdAt,
        updatedAt: createdAt,
      };
      reviews.set(row.id, row);
      return row;
    },

    async listReviewRequests(organizationId) {
      return [...reviews.values()]
        .filter((r) => r.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listDueReviewRequests(now, limit) {
      return [...reviews.values()]
        .filter((r) => r.status === "pending" && r.scheduledFor <= now)
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
        .slice(0, limit);
    },

    async updateReviewRequest(id, organizationId, patch) {
      const r = reviews.get(id);
      if (!r || r.organizationId !== organizationId) return null;
      const next = { ...r, ...patch, updatedAt: nowIso() };
      reviews.set(id, next);
      return next;
    },

    async addTimelineEvent(input) {
      const row: TimelineEvent = {
        id: input.id ?? createId("tl"),
        organizationId: input.organizationId,
        kind: input.kind,
        refId: input.refId,
        title: input.title,
        detail: input.detail,
        actor: input.actor,
        at: input.at,
      };
      timeline.set(row.id, row);
      return row;
    },

    async listTimeline(organizationId, limit = 100) {
      return [...timeline.values()]
        .filter((e) => e.organizationId === organizationId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit);
    },

    async enqueueCrmDlq(input) {
      const createdAt = nowIso();
      const row: CrmDlqItem = {
        id: input.id ?? createId("crmdlq"),
        organizationId: input.organizationId,
        eventType: input.eventType,
        payload: input.payload,
        lastError: input.lastError,
        attempts: input.attempts ?? 1,
        createdAt,
        updatedAt: createdAt,
      };
      crmDlq.set(row.id, row);
      return row;
    },

    async listCrmDlq(organizationId, limit = 50) {
      return [...crmDlq.values()]
        .filter((i) => i.organizationId === organizationId && !i.resolved)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },

    async listDueCrmDlq(limit) {
      return [...crmDlq.values()]
        .filter((i) => !i.resolved && i.attempts < 8)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, limit);
    },

    async updateCrmDlq(id, organizationId, patch) {
      const item = crmDlq.get(id);
      if (!item || item.organizationId !== organizationId) return null;
      if (patch.resolved) {
        crmDlq.delete(id);
        return { ...item, resolved: true, updatedAt: nowIso() };
      }
      const next = { ...item, ...patch, updatedAt: nowIso() };
      crmDlq.set(id, next);
      return next;
    },
  };
}

export type { OrgSettings, QualificationQuestion };
