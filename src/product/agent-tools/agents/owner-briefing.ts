/**
 * Daily owner briefing agent. Read-only (HITL level 2 — fully autonomous
 * within strict limits): it only reads the same dashboard metrics the owner
 * can already see at /app and sends one summary email, it never writes to
 * any lead/booking/call record.
 *
 * Reuses the existing dashboard aggregation (missed calls, recovery,
 * bookings, revenue) and the existing growth owner-notify email — no new
 * metrics pipeline, no new delivery channel.
 */
import { formatMoney } from "@/components/app/dashboard/format";
import {
  isSummaryDue,
  localDateKey,
  usableTimeZone,
} from "@/product/notifications/daily-summary";
import { loadDashboardOverview } from "@/product/saas/dashboard-load";
import { getSaasStore } from "@/product/saas/runtime";
import { getGrowthServices } from "@/product/growth";
import type { Organization } from "@/product/saas/types";
import { withAgentRun } from "../tools";

export type OwnerBriefingOutcome =
  | { organizationId: string; sent: true; day: string }
  | { organizationId: string; sent: false; reason: string };

function pickOwnerUserId(
  memberships: { userId: string; role: string }[],
): string | null {
  const owner =
    memberships.find((m) => m.role === "owner") ??
    memberships.find((m) => m.role === "admin");
  return owner?.userId ?? null;
}

function briefingLines(
  overview: Awaited<ReturnType<typeof loadDashboardOverview>>,
  locale: "en" | "fr",
): { label: string; value?: string | null }[] {
  const missed = overview.calls?.missed.current ?? 0;
  const recovered = overview.recovery?.recovered.current ?? 0;
  const booked = overview.appointments?.booked.current ?? 0;
  const revenue = overview.recordedRevenue?.current ?? null;
  const waiting = overview.recovery?.needsAttention.current ?? 0;

  return locale === "fr"
    ? [
        { label: "Appels manques", value: String(missed) },
        { label: "Clients recuperes", value: String(recovered) },
        { label: "Rendez-vous pris", value: String(booked) },
        { label: "Revenu enregistre", value: formatMoney(revenue, locale) },
        { label: "En attente de votre reponse", value: String(waiting) },
      ]
    : [
        { label: "Missed calls", value: String(missed) },
        { label: "Leads recovered", value: String(recovered) },
        { label: "Jobs booked", value: String(booked) },
        { label: "Revenue recorded", value: formatMoney(revenue, locale) },
        { label: "Waiting on you", value: String(waiting) },
      ];
}

async function briefOneOrganization(
  organization: Organization,
  now: Date,
): Promise<OwnerBriefingOutcome> {
  const zone = usableTimeZone(organization.timezone);
  if (!isSummaryDue(now, zone)) {
    return { organizationId: organization.id, sent: false, reason: "not_due" };
  }
  const memberships = await getSaasStore().listMembershipsForOrganization(
    organization.id,
  );
  const ownerUserId = pickOwnerUserId(memberships);
  if (!ownerUserId) {
    return { organizationId: organization.id, sent: false, reason: "no_owner" };
  }

  const overview = await loadDashboardOverview({
    organization,
    userId: ownerUserId,
    range: "today",
    now,
  });

  const locale = organization.localeDefault;
  const day = localDateKey(now, zone);
  const result = await getGrowthServices().notifyOwner({
    organizationId: organization.id,
    subject:
      locale === "fr"
        ? `Votre resume quotidien — ${organization.name}`
        : `Your daily briefing — ${organization.name}`,
    title: locale === "fr" ? "Resume d'aujourd'hui" : "Today's summary",
    lines: briefingLines(overview, locale),
  });

  if (!result.sent) {
    return {
      organizationId: organization.id,
      sent: false,
      reason: result.reason ?? "send_failed",
    };
  }
  return { organizationId: organization.id, sent: true, day };
}

/** Runs the briefing for every active organization due in its own local
 * time zone. Idempotency is the caller's responsibility (reuse the same
 * once-per-day cron window as `notifications.generateDailySummaries`) —
 * this function itself does not dedupe. */
export async function runOwnerBriefings(
  organizations: Organization[],
  now = new Date(),
): Promise<OwnerBriefingOutcome[]> {
  return withAgentRun(
    {
      agentName: "owner-briefing",
      trigger: "cron",
      organizationId: null,
      input: { organizationCount: organizations.length, now: now.toISOString() },
    },
    async (log) => {
      const outcomes: OwnerBriefingOutcome[] = [];
      for (const organization of organizations) {
        if (organization.status !== "active") continue;
        const started = Date.now();
        const outcome = await briefOneOrganization(organization, now);
        log({
          tool: "notify_owner",
          input: { organizationId: organization.id },
          output: outcome,
          durationMs: Date.now() - started,
        });
        outcomes.push(outcome);
      }
      return outcomes;
    },
  );
}
