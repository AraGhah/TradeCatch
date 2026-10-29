import type { ClientAccount, LeadRecord } from "./types";

export type TechnicianRevenueBreakdown = {
  technicianId: string;
  name: string;
  revenue: number;
  jobsCompleted: number;
};

export type MonthlyRevenue = {
  month: string; // "YYYY-MM"
  revenue: number;
};

export type AdvancedRevenueAnalytics = {
  technicianRevenue: TechnicianRevenueBreakdown[];
  revenueByMonth: MonthlyRevenue[];
  totalRevenue: number;
  bookedLeads: number;
  totalLeads: number;
  leadToRevenueConversionRate: number;
  averageRevenuePerBooking: number;
};

function leadRevenue(lead: LeadRecord): number {
  return lead.finalValue ?? lead.estimatedValue ?? 0;
}

function acceptingTechnicianId(lead: LeadRecord): string | null {
  const accepted = lead.techniciansAlerted.find(
    (a) => a.response === "accepted",
  );
  return accepted?.technicianId ?? null;
}

/**
 * ADVANCED_REVENUE_ANALYTICS (Receptionist tier): a superset of the Growth
 * analytics endpoint built entirely from data already captured by the
 * missed-call recovery pipeline — which technician accepted each job
 * (techniciansAlerted) and what it was worth (finalValue/estimatedValue) —
 * rather than a parallel, disconnected revenue model.
 */
export function computeAdvancedRevenueAnalytics(
  client: ClientAccount,
  leads: LeadRecord[],
): AdvancedRevenueAnalytics {
  const byTechnician = new Map<string, TechnicianRevenueBreakdown>();
  for (const tech of client.technicianRoster) {
    byTechnician.set(tech.id, {
      technicianId: tech.id,
      name: tech.name,
      revenue: 0,
      jobsCompleted: 0,
    });
  }

  const byMonth = new Map<string, number>();
  let totalRevenue = 0;
  let bookedLeads = 0;

  for (const lead of leads) {
    const revenue = leadRevenue(lead);
    if (lead.becameBooking) bookedLeads += 1;
    if (revenue <= 0) continue;

    totalRevenue += revenue;

    const month = lead.createdAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + revenue);

    const technicianId = acceptingTechnicianId(lead);
    if (technicianId) {
      const entry = byTechnician.get(technicianId);
      if (entry) {
        entry.revenue += revenue;
        entry.jobsCompleted += 1;
      }
    }
  }

  const revenueByMonth = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));

  const totalLeads = leads.length;
  return {
    technicianRevenue: [...byTechnician.values()].sort(
      (a, b) => b.revenue - a.revenue,
    ),
    revenueByMonth,
    totalRevenue,
    bookedLeads,
    totalLeads,
    leadToRevenueConversionRate: totalLeads > 0 ? bookedLeads / totalLeads : 0,
    averageRevenuePerBooking: bookedLeads > 0 ? totalRevenue / bookedLeads : 0,
  };
}
