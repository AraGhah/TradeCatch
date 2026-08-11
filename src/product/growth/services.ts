import type { SmsPort } from "@/product/missed-call/types";
import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import type { GrowthStore, PipelineStage } from "./memory-store";

export function createGrowthServices(deps: {
  store: GrowthStore;
  sms: SmsPort;
}) {
  const { store, sms } = deps;

  return {
    async bookAppointment(input: {
      organizationId: string;
      title: string;
      startsAt: string;
      endsAt?: string;
      customerName?: string;
      customerPhoneE164?: string;
      customerEmail?: string;
      source?: "manual" | "website" | "missed_call" | "quote";
      sourceRefId?: string;
      notes?: string;
      businessName?: string;
      smsFromE164?: string;
    }) {
      const appt = await store.createAppointment({
        organizationId: input.organizationId,
        title: input.title,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        customerName: input.customerName,
        customerPhoneE164: input.customerPhoneE164,
        customerEmail: input.customerEmail,
        status: "scheduled",
        source: input.source ?? "manual",
        sourceRefId: input.sourceRefId,
        notes: input.notes,
      });

      await store.upsertPipelineCard({
        organizationId: input.organizationId,
        stage: "booked",
        title: input.customerName || input.title,
        source:
          input.source === "website" ||
          input.source === "missed_call" ||
          input.source === "quote"
            ? input.source
            : "manual",
        sourceRefId: input.sourceRefId ?? appt.id,
        customerPhoneE164: input.customerPhoneE164,
      });

      await store.addTimelineEvent({
        organizationId: input.organizationId,
        kind: "appointment_booked",
        refId: appt.id,
        title: `Appointment: ${input.title}`,
        detail: input.startsAt,
        actor: "system",
        at: new Date().toISOString(),
      });

      if (input.customerPhoneE164 && input.smsFromE164) {
        const when = new Date(input.startsAt).toLocaleString();
        await sms.send({
          toE164: input.customerPhoneE164,
          fromE164: input.smsFromE164,
          body: `${input.businessName || "TradeCatch"}: your appointment "${input.title}" is booked for ${when}. Reply STOP to opt out.`,
        });
      }

      return appt;
    },

    async processAppointmentReminders(input: {
      businessNameForOrg: (id: string) => Promise<string>;
      smsFromForOrg: (id: string) => Promise<string | null>;
    }) {
      const now = new Date();
      const due = await store.listDueAppointmentReminders(now.toISOString());
      let sent = 0;
      for (const appt of due) {
        const from = await input.smsFromForOrg(appt.organizationId);
        if (!from || !appt.customerPhoneE164) continue;
        const start = Date.parse(appt.startsAt);
        const msLeft = start - now.getTime();
        const is2h = msLeft <= 2 * 60 * 60 * 1000;
        if (is2h && appt.reminder2hSent) continue;
        if (!is2h && appt.reminder24hSent) continue;

        const businessName = await input.businessNameForOrg(
          appt.organizationId,
        );
        const when = new Date(appt.startsAt).toLocaleString();
        const body = is2h
          ? `${businessName}: reminder — "${appt.title}" starts in about 2 hours (${when}).`
          : `${businessName}: reminder — "${appt.title}" is tomorrow (${when}).`;

        try {
          await sms.send({
            toE164: appt.customerPhoneE164,
            fromE164: from,
            body,
          });
          await store.updateAppointment(appt.id, appt.organizationId, {
            reminder2hSent: is2h ? true : appt.reminder2hSent,
            reminder24hSent: !is2h ? true : appt.reminder24hSent,
          });
          sent += 1;
        } catch {
          // continue
        }
      }
      return { sent };
    },

    async completeAppointmentAndMaybeReview(input: {
      organizationId: string;
      appointmentId: string;
      scheduleReviewHours?: number;
    }) {
      const appt = await store.updateAppointment(
        input.appointmentId,
        input.organizationId,
        { status: "completed" },
      );
      if (!appt) return null;

      const settings = await store.getOrgSettings(input.organizationId);
      if (settings.googleReviewUrl && appt.customerPhoneE164) {
        const hours = input.scheduleReviewHours ?? 24;
        await store.createReviewRequest({
          organizationId: input.organizationId,
          customerPhoneE164: appt.customerPhoneE164,
          customerName: appt.customerName,
          appointmentId: appt.id,
          scheduledFor: new Date(
            Date.now() + hours * 60 * 60 * 1000,
          ).toISOString(),
        });
      }
      return appt;
    },

    async processReviewRequests(input: {
      businessNameForOrg: (id: string) => Promise<string>;
      smsFromForOrg: (id: string) => Promise<string | null>;
    }) {
      const due = await store.listDueReviewRequests(new Date().toISOString(), 40);
      let sent = 0;
      let skipped = 0;
      for (const req of due) {
        const settings = await store.getOrgSettings(req.organizationId);
        const from = await input.smsFromForOrg(req.organizationId);
        if (!settings.googleReviewUrl || !from) {
          await store.updateReviewRequest(req.id, req.organizationId, {
            status: "skipped",
          });
          skipped += 1;
          continue;
        }
        const businessName = await input.businessNameForOrg(req.organizationId);
        const hi = req.customerName ? `Hi ${req.customerName}` : "Hi";
        try {
          await sms.send({
            toE164: req.customerPhoneE164,
            fromE164: from,
            body: `${hi}, thanks for choosing ${businessName}. If we did a good job, a Google review helps a lot: ${settings.googleReviewUrl}`,
          });
          await store.updateReviewRequest(req.id, req.organizationId, {
            status: "sent",
            sentAt: new Date().toISOString(),
          });
          sent += 1;
        } catch {
          await store.updateReviewRequest(req.id, req.organizationId, {
            status: "failed",
          });
        }
      }
      return { sent, skipped };
    },

    async movePipeline(input: {
      organizationId: string;
      cardId: string;
      stage: PipelineStage;
      estimatedValue?: number;
      recordRevenue?: boolean;
    }) {
      const card = await store.updatePipelineStage(
        input.cardId,
        input.organizationId,
        input.stage,
        input.estimatedValue,
      );
      if (!card) return null;

      await store.addTimelineEvent({
        organizationId: input.organizationId,
        kind: "pipeline_stage",
        refId: card.id,
        title: `${card.title} → ${input.stage}`,
        actor: "user",
        at: new Date().toISOString(),
      });

      if (
        input.stage === "won" &&
        input.recordRevenue &&
        (input.estimatedValue ?? card.estimatedValue)
      ) {
        const amount = input.estimatedValue ?? card.estimatedValue!;
        await store.addRevenueEvent({
          organizationId: input.organizationId,
          amount,
          currency: "CAD",
          source:
            card.source === "manual"
              ? "manual"
              : card.source === "missed_call"
                ? "missed_call"
                : card.source === "website"
                  ? "website"
                  : "quote",
          sourceRefId: card.sourceRefId,
          pipelineCardId: card.id,
          occurredAt: new Date().toISOString(),
        });
      }
      return card;
    },

    async notifyOwner(input: {
      organizationId: string;
      subject: string;
      title: string;
      lines: { label: string; value?: string | null }[];
      siteUrl?: string;
    }) {
      const settings = await store.getOrgSettings(input.organizationId);
      if (!settings.notifyEmail) return { sent: false, reason: "no_notify_email" };
      return sendBusinessNotifyEmail({
        toEmail: settings.notifyEmail,
        subject: input.subject,
        title: input.title,
        lines: input.lines,
        ctaUrl: input.siteUrl ? `${input.siteUrl}/app/inbox` : undefined,
        ctaLabel: "Open inbox",
      });
    },

    computeAdvancedAnalytics(input: {
      pipeline: Awaited<ReturnType<GrowthStore["listPipeline"]>>;
      revenue: Awaited<ReturnType<GrowthStore["listRevenue"]>>;
      appointments: Awaited<ReturnType<GrowthStore["listAppointments"]>>;
      reviews: Awaited<ReturnType<GrowthStore["listReviewRequests"]>>;
    }) {
      const byStage: Record<string, number> = {};
      let pipelineValue = 0;
      for (const c of input.pipeline) {
        byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;
        if (c.estimatedValue && c.stage !== "lost") {
          pipelineValue += c.estimatedValue;
        }
      }
      const attributedRevenue = input.revenue.reduce((s, r) => s + r.amount, 0);
      const bySource: Record<string, number> = {};
      for (const r of input.revenue) {
        bySource[r.source] = (bySource[r.source] ?? 0) + r.amount;
      }
      return {
        cardsByStage: byStage,
        openPipelineValue: pipelineValue,
        attributedRevenue,
        revenueBySource: bySource,
        upcomingAppointments: input.appointments.filter(
          (a) =>
            (a.status === "scheduled" || a.status === "confirmed") &&
            Date.parse(a.startsAt) >= Date.now(),
        ).length,
        reviewsSent: input.reviews.filter((r) => r.status === "sent").length,
      };
    },
  };
}

export type GrowthServices = ReturnType<typeof createGrowthServices>;
