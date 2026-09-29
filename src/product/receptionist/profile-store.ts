import { Pool } from "pg";
import {
  defaultProfileSettings,
  profileSettingsSchema,
  type ProfileSettings,
  type ReceptionistProfile,
} from "./profile";

export class ProfileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileConflictError";
  }
}

/** Identity-independent (see isConflictError in store.ts). */
export function isProfileConflict(err: unknown): boolean {
  return (
    err instanceof ProfileConflictError ||
    (err instanceof Error && err.name === "ProfileConflictError")
  );
}

export type ProfileStore = {
  getProfile(organizationId: string): Promise<ReceptionistProfile | null>;
  /** Profiles ops activated, with a number, ready to answer calls. */
  listActivatedProfiles(): Promise<ReceptionistProfile[]>;
  /** Owner edit: creates an inactive profile on first save. */
  saveSettings(
    organizationId: string,
    settings: ProfileSettings,
    updatedBy: string,
  ): Promise<ReceptionistProfile>;
  /**
   * Ops only. Throws ProfileConflictError when another organization already
   * answers the same number.
   */
  setActivation(
    organizationId: string,
    input: { phoneNumberE164: string; activated: boolean },
    updatedBy: string,
  ): Promise<ReceptionistProfile>;
};

function digits(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function createMemoryProfileStore(): ProfileStore {
  const rows = new Map<string, ReceptionistProfile>();
  const now = () => new Date().toISOString();
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    async getProfile(organizationId) {
      const row = rows.get(organizationId);
      return row ? clone(row) : null;
    },
    async listActivatedProfiles() {
      return Array.from(rows.values())
        .filter((p) => p.activated && p.phoneNumberE164)
        .map(clone);
    },
    async saveSettings(organizationId, settings, updatedBy) {
      const existing = rows.get(organizationId);
      const row: ReceptionistProfile = {
        organizationId,
        phoneNumberE164: existing?.phoneNumberE164,
        activated: existing?.activated ?? false,
        settings,
        updatedBy,
        updatedAt: now(),
      };
      rows.set(organizationId, row);
      return clone(row);
    },
    async setActivation(organizationId, input, updatedBy) {
      if (input.activated) {
        for (const other of rows.values()) {
          if (
            other.organizationId !== organizationId &&
            other.activated &&
            other.phoneNumberE164 &&
            digits(other.phoneNumberE164) === digits(input.phoneNumberE164)
          ) {
            throw new ProfileConflictError(
              "Number already answered by another organization",
            );
          }
        }
      }
      const existing = rows.get(organizationId);
      const row: ReceptionistProfile = {
        organizationId,
        phoneNumberE164: input.phoneNumberE164,
        activated: input.activated,
        settings: existing?.settings ?? defaultProfileSettings(),
        updatedBy,
        updatedAt: now(),
      };
      rows.set(organizationId, row);
      return clone(row);
    },
  };
}

/* --------------------------------------------------------------- postgres */

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

function mapRow(r: Record<string, unknown>): ReceptionistProfile {
  const raw =
    typeof r.settings === "string" ? JSON.parse(r.settings) : r.settings;
  // Re-parse so old rows pick up new defaults and stay type-safe.
  const parsed = profileSettingsSchema.safeParse(raw ?? {});
  return {
    organizationId: String(r.organization_id),
    phoneNumberE164: (r.phone_number_e164 as string) || undefined,
    activated: Boolean(r.activated),
    settings: parsed.success ? parsed.data : defaultProfileSettings(),
    updatedBy: (r.updated_by as string) || undefined,
    updatedAt: new Date(r.updated_at as string | Date).toISOString(),
  };
}

export function createPostgresProfileStore(url: string): ProfileStore {
  const pool = getPool(url);
  return {
    async getProfile(organizationId) {
      const res = await pool.query(
        `SELECT * FROM rc_profiles WHERE organization_id = $1`,
        [organizationId],
      );
      return res.rows[0] ? mapRow(res.rows[0]) : null;
    },
    async listActivatedProfiles() {
      const res = await pool.query(
        `SELECT * FROM rc_profiles WHERE activated AND phone_number_e164 IS NOT NULL`,
      );
      return res.rows.map(mapRow);
    },
    async saveSettings(organizationId, settings, updatedBy) {
      const res = await pool.query(
        `INSERT INTO rc_profiles (organization_id, settings, updated_by)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (organization_id) DO UPDATE
           SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [organizationId, JSON.stringify(settings), updatedBy],
      );
      return mapRow(res.rows[0]);
    },
    async setActivation(organizationId, input, updatedBy) {
      try {
        const res = await pool.query(
          `INSERT INTO rc_profiles (organization_id, phone_number_e164, activated, settings, updated_by)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (organization_id) DO UPDATE
             SET phone_number_e164 = EXCLUDED.phone_number_e164, activated = EXCLUDED.activated,
                 updated_by = EXCLUDED.updated_by, updated_at = now()
           RETURNING *`,
          [
            organizationId,
            input.phoneNumberE164,
            input.activated,
            JSON.stringify(defaultProfileSettings()),
            updatedBy,
          ],
        );
        return mapRow(res.rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ProfileConflictError(
            "Number already answered by another organization",
          );
        }
        throw err;
      }
    },
  };
}
