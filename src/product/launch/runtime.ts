import { getPgPool } from "@/product/missed-call/postgres-store";
import { evaluateLaunchReadiness } from "./readiness";
import { createLaunchService } from "./service";
import { createMemoryLaunchStore, type LaunchStore, type PilotAccount, type PilotFeature } from "./store";

const globalForLaunch = globalThis as unknown as { __tradecatchLaunch?: LaunchStore };

function store(): LaunchStore {
  if (!globalForLaunch.__tradecatchLaunch) {
    const url = process.env.DATABASE_URL?.trim();
    const durable = process.env.MISSED_CALL_DURABLE_STORE === "1" || process.env.SAAS_DURABLE_STORE === "1";
    globalForLaunch.__tradecatchLaunch = durable && url ? postgresStore(url) : createMemoryLaunchStore();
  }
  return globalForLaunch.__tradecatchLaunch;
}

export function getLaunchService() {
  return createLaunchService({ store: store(), now: () => new Date() });
}

export async function currentReadiness() {
  let database: { ok: boolean; error?: string } = { ok: false, error: "not_checked" };
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    try {
      const { getPgPool } = await import("@/product/missed-call/postgres-store");
      await getPgPool(url).query("SELECT 1");
      database = { ok: true };
    } catch {
      database = { ok: false, error: "required query failed" };
    }
  }
  return evaluateLaunchReadiness(process.env, database);
}

function postgresStore(connectionString: string): LaunchStore {
  const pool = getPgPool(connectionString);
  return {
    async savePilot(row) {
      await pool.query(
        `INSERT INTO tc_pilot_accounts (
          id, organization_id, business_name, industry, contact_name, contact_email, phone_e164, starts_on, ends_on, features_json, onboarding_status, phone_status, ai_status, pilot_status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          features_json = EXCLUDED.features_json, onboarding_status = EXCLUDED.onboarding_status,
          phone_status = EXCLUDED.phone_status, ai_status = EXCLUDED.ai_status, pilot_status = EXCLUDED.pilot_status, ends_on = EXCLUDED.ends_on, starts_on = EXCLUDED.starts_on`,
        [row.id, row.organizationId, row.businessName, row.industry ?? null, row.contactName, row.contactEmail, row.phoneE164 ?? null, row.startsOn ?? null, row.endsOn ?? null, JSON.stringify(row.features), row.onboardingStatus, row.phoneStatus, row.aiStatus, row.pilotStatus, row.createdAt],
      );
    },
    async listPilots() {
      const res = await pool.query(`SELECT * FROM tc_pilot_accounts ORDER BY created_at DESC`);
      return res.rows.map(pilotFrom);
    },
    async getPilot(id) {
      const res = await pool.query(`SELECT * FROM tc_pilot_accounts WHERE id = $1`, [id]);
      return res.rows[0] ? pilotFrom(res.rows[0]) : null;
    },
    async getPilotByOrg(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_pilot_accounts WHERE organization_id = $1`, [organizationId]);
      return res.rows[0] ? pilotFrom(res.rows[0]) : null;
    },
    async saveFeedback(row) {
      await pool.query(
        `INSERT INTO tc_pilot_feedback (id, organization_id, category, description, priority, reference, status, resolution, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolution = EXCLUDED.resolution`,
        [row.id, row.organizationId, row.category, row.description, row.priority, row.reference ?? null, row.status, row.resolution ?? null, row.createdAt],
      );
    },
    async listFeedback(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_pilot_feedback WHERE ($1::text IS NULL OR organization_id = $1) ORDER BY created_at DESC`, [organizationId ?? null]);
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        category: row.category,
        description: String(row.description),
        priority: row.priority,
        reference: row.reference ? String(row.reference) : undefined,
        status: row.status,
        resolution: row.resolution ? String(row.resolution) : undefined,
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    },
    async saveTests(rows) {
      for (const row of rows) {
        await pool.query(
          `INSERT INTO tc_pilot_tests (id, pilot_id, scenario, status, note, verified_at) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, verified_at = EXCLUDED.verified_at`,
          [row.id, row.pilotId, row.scenario, row.status, row.note ?? null, row.verifiedAt ?? null],
        );
      }
    },
    async listTests(pilotId) {
      const res = await pool.query(`SELECT * FROM tc_pilot_tests WHERE pilot_id = $1`, [pilotId]);
      return res.rows.map((row) => ({
        id: String(row.id),
        pilotId: String(row.pilot_id),
        scenario: String(row.scenario),
        status: row.status,
        note: row.note ? String(row.note) : undefined,
        verifiedAt: row.verified_at ? new Date(String(row.verified_at)).toISOString() : undefined,
      }));
    },
    async saveEvent(input) {
      await pool.query(`INSERT INTO tc_pilot_events (id, organization_id, kind, created_at) VALUES ($1,$2,$3,$4)`, [input.id, input.organizationId, input.kind, input.createdAt]);
    },
    async listEvents(organizationId) {
      const res = await pool.query(`SELECT kind FROM tc_pilot_events WHERE organization_id = $1`, [organizationId]);
      return res.rows.map((row) => ({ kind: String(row.kind) }));
    },
    async saveActivation(input) {
      await pool.query(`INSERT INTO tc_production_activations (id, pilot_id, features_json, activated_at) VALUES ($1,$2,$3,$4)`, [input.id, input.pilotId, JSON.stringify(input.features), input.activatedAt]);
    },
    async listActivations(pilotId) {
      const res = await pool.query(`SELECT features_json, activated_at FROM tc_production_activations WHERE pilot_id = $1`, [pilotId]);
      return res.rows.map((row) => ({ features: row.features_json as PilotFeature[], activatedAt: new Date(String(row.activated_at)).toISOString() }));
    },
  };
}

function pilotFrom(row: Record<string, unknown>): PilotAccount {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    businessName: String(row.business_name),
    industry: row.industry ? String(row.industry) : undefined,
    contactName: String(row.contact_name),
    contactEmail: String(row.contact_email),
    phoneE164: row.phone_e164 ? String(row.phone_e164) : undefined,
    startsOn: row.starts_on ? String(row.starts_on).slice(0, 10) : undefined,
    endsOn: row.ends_on ? String(row.ends_on).slice(0, 10) : undefined,
    features: (row.features_json as PilotFeature[]) || [],
    onboardingStatus: row.onboarding_status as PilotAccount["onboardingStatus"],
    phoneStatus: row.phone_status as PilotAccount["phoneStatus"],
    aiStatus: row.ai_status as PilotAccount["aiStatus"],
    pilotStatus: row.pilot_status as PilotAccount["pilotStatus"],
    accountType: "live",
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
