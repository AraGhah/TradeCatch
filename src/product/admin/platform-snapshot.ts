import { getPgPool } from "@/product/missed-call/postgres-store";
import { getSaasStore } from "@/product/saas/runtime";
import type { Organization } from "@/product/saas/types";
import {
  buildPlatformStats,
  type PlatformOrg,
  type PlatformStats,
  type PlatformUsage,
} from "./platform-stats";

export type PlatformHealth = {
  overall: string;
  averageMs: number;
  p95Ms: number;
  serverErrors: number;
  openIncidents: number;
};

export type PlatformAudit = {
  action: string;
  organizationId?: string;
  at: string;
};

export type PlatformSnapshot = PlatformStats & {
  stripeConfigured: boolean;
  health: PlatformHealth | null;
  audit: PlatformAudit[];
};

const CACHE_MS = 15_000;
let cached: { at: number; value: PlatformSnapshot } | null = null;

export function clearPlatformSnapshot() {
  cached = null;
}

function durable() {
  return Boolean(process.env.DATABASE_URL?.trim()) &&
    (process.env.SAAS_DURABLE_STORE === "1" || process.env.MISSED_CALL_DURABLE_STORE === "1");
}

function toOrg(org: Organization): PlatformOrg {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    status: org.status,
    accountType: org.accountType,
    city: org.city,
    industry: org.industry,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    missedCallClientId: org.missedCallClientId,
  };
}

async function grouped(sql: string): Promise<Record<string, number>> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return {};
  const res = await getPgPool(url).query<{ id: string; n: number }>(sql);
  const out: Record<string, number> = {};
  for (const row of res.rows) out[String(row.id)] = Number(row.n);
  return out;
}

async function usageFromDatabase(): Promise<PlatformUsage> {
  const [leadsByClient, calls, completed, appointmentsByOrg] = await Promise.all([
    grouped(`SELECT client_account_id AS id, count(*)::int AS n FROM mc_leads WHERE deleted_at IS NULL GROUP BY 1`).catch(() => ({})),
    grouped(`SELECT client_account_id AS id, count(*)::int AS n FROM rc_call_sessions GROUP BY 1`).catch(() => ({})),
    grouped(`SELECT client_account_id AS id, count(*)::int AS n FROM rc_call_sessions WHERE status = 'completed' GROUP BY 1`).catch(() => ({})),
    grouped(`SELECT organization_id AS id, count(*)::int AS n FROM tc_appointments GROUP BY 1`).catch(() => ({})),
  ]);
  return { leadsByClient, callsByClient: calls, completedCallsByClient: completed, appointmentsByOrg };
}

async function usageFromMemory(orgs: Organization[]): Promise<PlatformUsage> {
  const usage: PlatformUsage = {
    leadsByClient: {},
    callsByClient: {},
    completedCallsByClient: {},
    appointmentsByOrg: {},
  };
  try {
    const { ensureMissedCallReady } = await import("@/product/missed-call/runtime");
    const { store } = await ensureMissedCallReady();
    for (const lead of await store.listLeads()) {
      usage.leadsByClient[lead.clientAccountId] = (usage.leadsByClient[lead.clientAccountId] ?? 0) + 1;
    }
  } catch {
    usage.leadsByClient = {};
  }
  try {
    const { getReceptionistRuntime } = await import("@/product/receptionist/runtime");
    const calls = await getReceptionistRuntime().store.listSessions({ limit: 1000 });
    for (const call of calls) {
      usage.callsByClient[call.clientAccountId] = (usage.callsByClient[call.clientAccountId] ?? 0) + 1;
      if (call.status === "completed") {
        usage.completedCallsByClient[call.clientAccountId] =
          (usage.completedCallsByClient[call.clientAccountId] ?? 0) + 1;
      }
    }
  } catch {
    usage.callsByClient = {};
  }
  try {
    const { getGrowthStore } = await import("@/product/growth");
    const store = getGrowthStore();
    await Promise.all(
      orgs.map(async (org) => {
        try {
          usage.appointmentsByOrg[org.id] = (await store.listAppointments(org.id)).length;
        } catch {
          usage.appointmentsByOrg[org.id] = 0;
        }
      }),
    );
  } catch {
    usage.appointmentsByOrg = {};
  }
  return usage;
}

async function health(): Promise<PlatformHealth | null> {
  try {
    const { getReliabilityService } = await import("@/product/reliability/runtime");
    const overview = await getReliabilityService().overview();
    return {
      overall: overview.overall,
      averageMs: overview.averageMs,
      p95Ms: overview.p95Ms,
      serverErrors: overview.serverErrors,
      openIncidents: overview.incidents.length,
    };
  } catch {
    return null;
  }
}

export async function loadPlatformSnapshot(): Promise<PlatformSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const orgs = await getSaasStore().listOrganizations();
  let usage: PlatformUsage = {
    leadsByClient: {},
    callsByClient: {},
    completedCallsByClient: {},
    appointmentsByOrg: {},
  };
  try {
    usage = durable() ? await usageFromDatabase() : await usageFromMemory(orgs);
  } catch {
    usage = {
      leadsByClient: {},
      callsByClient: {},
      completedCallsByClient: {},
      appointmentsByOrg: {},
    };
  }
  const stats = buildPlatformStats(orgs.map(toOrg), usage);
  let audit: PlatformAudit[] = [];
  try {
    const { getSecurityService } = await import("@/product/security/runtime");
    const events = await getSecurityService().listAudit();
    audit = events.slice(0, 12).map((event) => ({
      action: event.action,
      organizationId: event.organizationId,
      at: event.createdAt,
    }));
  } catch {
    audit = [];
  }
  const value: PlatformSnapshot = {
    ...stats,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    health: await health(),
    audit,
  };
  cached = { at: Date.now(), value };
  return value;
}
