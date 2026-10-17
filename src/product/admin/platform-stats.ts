import { PLAN_PRICES } from "@/lib/plans";
import type { PlanId } from "@/product/saas/entitlements";
import type { OrgStatus } from "@/product/saas/types";

export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  status: OrgStatus;
  accountType: string;
  city: string | null;
  industry: string | null;
  createdAt: string;
  updatedAt: string;
  missedCallClientId: string | null;
};

export type PlatformUsage = {
  leadsByClient: Record<string, number>;
  callsByClient: Record<string, number>;
  completedCallsByClient: Record<string, number>;
  appointmentsByOrg: Record<string, number>;
};

export type PlatformRow = PlatformOrg & {
  monthly: number;
  leads: number;
  calls: number;
  completedCalls: number;
  appointments: number;
};

export type PlatformStats = {
  businesses: number;
  activeSubscriptions: number;
  suspended: number;
  cancelled: number;
  demos: number;
  mrr: number;
  leads: number;
  calls: number;
  aiCompleted: number;
  appointments: number;
  signups30d: number;
  cancellations30d: number;
  churnRate: number;
  growthShare: number;
  series: { month: string; signups: number; cancellations: number }[];
  rows: PlatformRow[];
  recent: { id: string; name: string; kind: "registration" | "cancellation"; at: string }[];
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

export function recentMonths(now: Date, count = 6): string[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - index, 1));
    months.push(month.toISOString().slice(0, 7));
  }
  return months;
}

function countFor(map: Record<string, number>, id: string | null) {
  if (!id) return 0;
  return map[id] ?? 0;
}

export function buildPlatformStats(
  orgs: PlatformOrg[],
  usage: PlatformUsage,
  now = new Date(),
): PlatformStats {
  const rows: PlatformRow[] = orgs.map((org) => ({
    ...org,
    monthly: org.accountType === "demo" || org.status !== "active" ? 0 : PLAN_PRICES[org.plan].monthly,
    leads: countFor(usage.leadsByClient, org.missedCallClientId),
    calls: countFor(usage.callsByClient, org.missedCallClientId),
    completedCalls: countFor(usage.completedCallsByClient, org.missedCallClientId),
    appointments: usage.appointmentsByOrg[org.id] ?? 0,
  }));
  const live = rows.filter((org) => org.accountType !== "demo");
  const active = live.filter((org) => org.status === "active");
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const months = recentMonths(now);
  const series = months.map((month) => ({
    month,
    signups: live.filter((org) => monthKey(org.createdAt) === month).length,
    cancellations: live.filter((org) => org.status === "churned" && monthKey(org.updatedAt) === month).length,
  }));
  const recent = [
    ...live.map((org) => ({ id: org.id, name: org.name, kind: "registration" as const, at: org.createdAt })),
    ...live
      .filter((org) => org.status === "churned")
      .map((org) => ({ id: org.id, name: org.name, kind: "cancellation" as const, at: org.updatedAt })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return {
    businesses: live.length,
    activeSubscriptions: active.length,
    suspended: live.filter((org) => org.status === "suspended").length,
    cancelled: live.filter((org) => org.status === "churned").length,
    demos: rows.length - live.length,
    mrr: money(active.reduce((sum, org) => sum + org.monthly, 0)),
    leads: live.reduce((sum, org) => sum + org.leads, 0),
    calls: live.reduce((sum, org) => sum + org.calls, 0),
    aiCompleted: live.reduce((sum, org) => sum + org.completedCalls, 0),
    appointments: live.reduce((sum, org) => sum + org.appointments, 0),
    signups30d: live.filter((org) => Date.parse(org.createdAt) >= since).length,
    cancellations30d: live.filter((org) => org.status === "churned" && Date.parse(org.updatedAt) >= since).length,
    churnRate: live.length === 0 ? 0 : live.filter((org) => org.status === "churned").length / live.length,
    growthShare: active.length === 0 ? 0 : active.filter((org) => org.plan === "growth").length / active.length,
    series,
    rows,
    recent,
  };
}

export function filterPlatformRows(
  rows: PlatformRow[],
  filter: { q?: string; status?: string; plan?: string; businessId?: string; from?: string; to?: string },
) {
  const q = filter.q?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (filter.businessId && row.id !== filter.businessId) return false;
    if (filter.status && row.status !== filter.status) return false;
    if (filter.plan && row.plan !== filter.plan) return false;
    if (filter.from && row.createdAt.slice(0, 10) < filter.from) return false;
    if (filter.to && row.createdAt.slice(0, 10) > filter.to) return false;
    if (!q) return true;
    return [row.name, row.slug, row.city ?? "", row.industry ?? ""].join(" ").toLowerCase().includes(q);
  });
}

export function pageRows<T>(rows: T[], page: number, pageSize = 20) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(pages, Math.max(1, page));
  const start = (current - 1) * pageSize;
  return { page: current, pages, rows: rows.slice(start, start + pageSize) };
}
