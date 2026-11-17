import type { Pool } from "pg";
import {
  defaultPrivacySettings,
  describeChanges,
  isRetentionDays,
  type PrivacyPatch,
  type PrivacySettings,
} from "./settings";

export type PrivacyAuditRow = {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: "privacy_settings_updated";
  detail: string;
  createdAt: string;
};

export type PrivacyUpdate = {
  organizationId: string;
  patch: PrivacyPatch;
  /** The version the caller last saw. A save against an older one is refused. */
  expectedVersion: number;
  actorUserId: string;
  at: string;
  auditId: string;
};

export type PrivacyUpdateResult =
  | { ok: true; settings: PrivacySettings; changed: string }
  | { ok: false; reason: "conflict"; current: PrivacySettings };

export interface PrivacySettingsStore {
  /** Stored settings, or the new-business defaults (version 0) when none were ever saved. */
  get(organizationId: string): Promise<PrivacySettings>;
  /** Many at once, for the retention job and the call runtime. Missing ids get defaults. */
  getMany(organizationIds: readonly string[]): Promise<Map<string, PrivacySettings>>;
  /**
   * Applies only the named settings, only if the stored version still equals
   * `expectedVersion`, and writes the audit row in the same step: a refused or
   * failed save leaves neither a changed setting nor an audit entry.
   */
  update(input: PrivacyUpdate): Promise<PrivacyUpdateResult>;
}

function apply(current: PrivacySettings, input: PrivacyUpdate): PrivacySettings {
  return {
    ...current,
    ...input.patch,
    version: current.version + 1,
    updatedAt: input.at,
    updatedBy: input.actorUserId,
  };
}

export function createMemoryPrivacyStore(
  onAudit: (row: PrivacyAuditRow) => Promise<void> | void = () => {},
): PrivacySettingsStore {
  const rows = new Map<string, PrivacySettings>();
  const read = (id: string) => rows.get(id) ?? defaultPrivacySettings(id);
  return {
    async get(organizationId) {
      return { ...read(organizationId) };
    },
    async getMany(ids) {
      return new Map(ids.map((id) => [id, { ...read(id) }]));
    },
    async update(input) {
      const current = read(input.organizationId);
      if (current.version !== input.expectedVersion) {
        return { ok: false, reason: "conflict", current: { ...current } };
      }
      const next = apply(current, input);
      const changed = describeChanges(current, next);
      const previous = rows.get(input.organizationId);
      // Claim the version before awaiting anything, so a second save from the
      // same version sees it and is refused (the row lock does this in Postgres).
      rows.set(input.organizationId, next);
      try {
        await onAudit({
          id: input.auditId,
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "privacy_settings_updated",
          detail: changed || "no change",
          createdAt: input.at,
        });
      } catch (error) {
        // No audit, no change: same as the Postgres transaction rolling back.
        if (rows.get(input.organizationId) === next) {
          if (previous) rows.set(input.organizationId, previous);
          else rows.delete(input.organizationId);
        }
        throw error;
      }
      return { ok: true, settings: { ...next }, changed };
    },
  };
}

const COLUMNS = {
  callRecordingEnabled: "call_recording_enabled",
  saveCallTranscripts: "save_call_transcripts",
  saveSmsHistory: "save_sms_history",
  customerDataRetentionDays: "customer_data_retention_days",
  analyticsEnabled: "analytics_enabled",
} as const;

function fromRow(row: Record<string, unknown>): PrivacySettings {
  const days = row.customer_data_retention_days;
  return {
    organizationId: String(row.organization_id),
    callRecordingEnabled: Boolean(row.call_recording_enabled),
    saveCallTranscripts: Boolean(row.save_call_transcripts),
    saveSmsHistory: Boolean(row.save_sms_history),
    customerDataRetentionDays:
      days === null || days === undefined
        ? null
        : isRetentionDays(Number(days))
          ? (Number(days) as PrivacySettings["customerDataRetentionDays"])
          : null,
    analyticsEnabled: Boolean(row.analytics_enabled),
    version: Number(row.version),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
  };
}

export function createPostgresPrivacyStore(pool: Pool): PrivacySettingsStore {
  async function get(organizationId: string) {
    const res = await pool.query(
      `SELECT * FROM tc_privacy_settings WHERE organization_id = $1`,
      [organizationId],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : defaultPrivacySettings(organizationId);
  }

  return {
    get,
    async getMany(ids) {
      const out = new Map<string, PrivacySettings>(
        ids.map((id) => [id, defaultPrivacySettings(id)]),
      );
      if (ids.length === 0) return out;
      const res = await pool.query(
        `SELECT * FROM tc_privacy_settings WHERE organization_id = ANY($1::text[])`,
        [ids],
      );
      for (const row of res.rows) {
        const settings = fromRow(row);
        out.set(settings.organizationId, settings);
      }
      return out;
    },
    async update(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          `SELECT * FROM tc_privacy_settings WHERE organization_id = $1 FOR UPDATE`,
          [input.organizationId],
        );
        const current = locked.rows[0]
          ? fromRow(locked.rows[0])
          : defaultPrivacySettings(input.organizationId);
        if (current.version !== input.expectedVersion) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "conflict", current };
        }
        const next = apply(current, input);
        let saved: PrivacySettings;
        if (locked.rows[0]) {
          // Only the named settings are written; every other column keeps
          // whatever is stored, even if this caller never loaded it.
          const sets: string[] = [];
          const values: unknown[] = [input.organizationId, input.expectedVersion];
          for (const [field, value] of Object.entries(input.patch)) {
            values.push(value);
            sets.push(`${COLUMNS[field as keyof typeof COLUMNS]} = $${values.length}`);
          }
          values.push(input.at, input.actorUserId);
          const res = await client.query(
            `UPDATE tc_privacy_settings
             SET ${sets.join(", ")}, version = version + 1,
                 updated_at = $${values.length - 1}, updated_by = $${values.length}
             WHERE organization_id = $1 AND version = $2
             RETURNING *`,
            values,
          );
          saved = fromRow(res.rows[0]);
        } else {
          const res = await client.query(
            `INSERT INTO tc_privacy_settings (organization_id, call_recording_enabled,
               save_call_transcripts, save_sms_history, customer_data_retention_days,
               analytics_enabled, version, updated_at, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8)
             ON CONFLICT (organization_id) DO NOTHING
             RETURNING *`,
            [
              input.organizationId,
              next.callRecordingEnabled,
              next.saveCallTranscripts,
              next.saveSmsHistory,
              next.customerDataRetentionDays,
              next.analyticsEnabled,
              input.at,
              input.actorUserId,
            ],
          );
          if (!res.rows[0]) {
            // Another save created the row first: this one is stale.
            await client.query("ROLLBACK");
            return { ok: false, reason: "conflict", current: await get(input.organizationId) };
          }
          saved = fromRow(res.rows[0]);
        }
        const changed = describeChanges(current, saved);
        await client.query(
          `INSERT INTO tc_audit_logs (id, organization_id, actor_user_id, action, target, detail, created_at)
           VALUES ($1,$2,$3,'privacy_settings_updated','privacy_settings',$4,$5)`,
          [input.auditId, input.organizationId, input.actorUserId, changed || "no change", input.at],
        );
        await client.query("COMMIT");
        return { ok: true, settings: saved, changed };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
