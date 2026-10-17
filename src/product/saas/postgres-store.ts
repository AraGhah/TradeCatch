import type { Pool, QueryResultRow } from "pg";
import { Pool as PgPool } from "pg";
import type { PlanId } from "./entitlements";
import { newId, slugify } from "./ids";
import { mapOrgRow, mapUserRow, type OrgRow, type UserRow } from "./org-mapping";
import { normalizeEmail, type SaasStore } from "./store";
import {
  mergeBusinessFeatures,
  type MagicLink,
  type Membership,
  type Session,
} from "./types";

type MemRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  created_at: Date;
};

function mapMembership(row: MemRow): Membership {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as Membership["role"],
    createdAt: row.created_at.toISOString(),
  };
}

const pools = new Map<string, Pool>();

function getPool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new PgPool({ connectionString, max: 5 });
    pools.set(connectionString, pool);
  }
  return pool;
}

export function createPostgresSaasStore(connectionString: string): SaasStore {
  const pool = getPool(connectionString);

  async function query<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ) {
    return pool.query<T>(text, params);
  }

  return {
    async createOrganizationWithOwner(input) {
      const client = await pool.connect();
      const email = normalizeEmail(input.ownerEmail);
      const createdAt = new Date();
      const features = mergeBusinessFeatures(input.features);
      try {
        await client.query("BEGIN");

        let userRow = (
          await client.query<UserRow>(
            `SELECT * FROM tc_users WHERE email = $1`,
            [email],
          )
        ).rows[0];

        if (!userRow) {
          const userId = newId("usr");
          userRow = (
            await client.query<UserRow>(
              `INSERT INTO tc_users (id, email, name, locale, platform_role, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 'none', $5, $5)
               RETURNING *`,
              [
                userId,
                email,
                input.ownerName.trim() || email.split("@")[0] || "Owner",
                input.locale ?? "en",
                createdAt,
              ],
            )
          ).rows[0];
        }

        let slug = slugify(input.slug || input.name);
        let suffix = 0;
        for (;;) {
          const candidate = suffix ? `${slug}-${suffix}` : slug;
          const exists = await client.query(
            `SELECT 1 FROM tc_organizations WHERE slug = $1`,
            [candidate],
          );
          if (exists.rowCount === 0) {
            slug = candidate;
            break;
          }
          suffix += 1;
        }

        const orgId = newId("org");
        const orgRow = (
          await client.query<OrgRow>(
            `INSERT INTO tc_organizations
               (id, name, slug, plan, status, missed_call_client_id,
                account_type, industry, phone_e164, city, service_area,
                timezone, locale_default, features_json, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $15)
             RETURNING *`,
            [
              orgId,
              input.name.trim(),
              slug,
              input.plan ?? "starter",
              input.status ?? "active",
              input.missedCallClientId ?? null,
              input.accountType ?? "pilot",
              input.industry ?? null,
              input.phoneE164 ?? null,
              input.city ?? null,
              input.serviceArea ?? "",
              input.timezone?.trim() || "America/Toronto",
              input.locale ?? "en",
              JSON.stringify(features),
              createdAt,
            ],
          )
        ).rows[0];

        if (input.missedCallClientId) {
          await client.query(
            `UPDATE mc_clients SET organization_id = $1 WHERE id = $2`,
            [orgId, input.missedCallClientId],
          );
        }

        const memId = newId("mem");
        const memRow = (
          await client.query<MemRow>(
            `INSERT INTO tc_memberships
               (id, organization_id, user_id, role, created_at)
             VALUES ($1, $2, $3, 'owner', $4)
             RETURNING *`,
            [memId, orgId, userRow.id, createdAt],
          )
        ).rows[0];

        await client.query("COMMIT");
        return {
          organization: mapOrgRow(orgRow),
          user: mapUserRow(userRow),
          membership: mapMembership(memRow),
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async getOrganization(id) {
      const { rows } = await query<OrgRow>(
        `SELECT * FROM tc_organizations WHERE id = $1`,
        [id],
      );
      return rows[0] ? mapOrgRow(rows[0]) : null;
    },

    async getOrganizationBySlug(slug) {
      const { rows } = await query<OrgRow>(
        `SELECT * FROM tc_organizations WHERE slug = $1`,
        [slug],
      );
      return rows[0] ? mapOrgRow(rows[0]) : null;
    },

    async listOrganizations(filter) {
      if (filter?.accountType) {
        const { rows } = await query<OrgRow>(
          `SELECT * FROM tc_organizations
           WHERE account_type = $1
           ORDER BY created_at DESC`,
          [filter.accountType],
        );
        return rows.map(mapOrgRow);
      }
      const { rows } = await query<OrgRow>(
        `SELECT * FROM tc_organizations ORDER BY created_at DESC`,
      );
      return rows.map(mapOrgRow);
    },

    async updateOrganization(id, patch) {
      const current = await this.getOrganization(id);
      if (!current) return null;
      const features = patch.features
        ? mergeBusinessFeatures({ ...current.features, ...patch.features })
        : current.features;
      const { rows } = await query<OrgRow>(
        `UPDATE tc_organizations SET
           name = $2,
           plan = $3,
           status = $4,
           industry = $5,
           phone_e164 = $6,
           city = $7,
           service_area = $8,
           timezone = $9,
           locale_default = $10,
           features_json = $11::jsonb,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          patch.name?.trim() || current.name,
          patch.plan ?? current.plan,
          patch.status ?? current.status,
          patch.industry !== undefined ? patch.industry : current.industry,
          patch.phoneE164 !== undefined ? patch.phoneE164 : current.phoneE164,
          patch.city !== undefined ? patch.city : current.city,
          patch.serviceArea !== undefined
            ? patch.serviceArea
            : current.serviceArea,
          patch.timezone?.trim() || current.timezone,
          patch.localeDefault ?? current.localeDefault,
          JSON.stringify(features),
        ],
      );
      return rows[0] ? mapOrgRow(rows[0]) : null;
    },

    async updateOrganizationPlan(id, plan) {
      return this.updateOrganization(id, { plan });
    },

    async deleteOrganization(id) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const org = (
          await client.query<{ missed_call_client_id: string | null }>(
            `SELECT missed_call_client_id FROM tc_organizations WHERE id = $1`,
            [id],
          )
        ).rows[0];
        if (!org) {
          await client.query("ROLLBACK");
          return false;
        }
        const clientId = org.missed_call_client_id;
        await client.query(`DELETE FROM tc_organizations WHERE id = $1`, [id]);
        if (clientId) {
          // Drop the linked Module A client only when it belongs to this org.
          await client.query(
            `DELETE FROM mc_clients
             WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)`,
            [clientId, id],
          );
        }
        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async linkMissedCallClient(organizationId, clientId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<OrgRow>(
          `UPDATE tc_organizations
           SET missed_call_client_id = $2, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [organizationId, clientId],
        );
        await client.query(
          `UPDATE mc_clients SET organization_id = $1 WHERE id = $2`,
          [organizationId, clientId],
        );
        await client.query("COMMIT");
        return rows[0] ? mapOrgRow(rows[0]) : null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async findOrganizationByMissedCallClientId(clientId) {
      const { rows } = await query<OrgRow>(
        `SELECT * FROM tc_organizations WHERE missed_call_client_id = $1`,
        [clientId],
      );
      return rows[0] ? mapOrgRow(rows[0]) : null;
    },

    async getUserByEmail(email) {
      const { rows } = await query<UserRow>(
        `SELECT * FROM tc_users WHERE email = $1`,
        [normalizeEmail(email)],
      );
      return rows[0] ? mapUserRow(rows[0]) : null;
    },

    async getUser(id) {
      const { rows } = await query<UserRow>(
        `SELECT * FROM tc_users WHERE id = $1`,
        [id],
      );
      return rows[0] ? mapUserRow(rows[0]) : null;
    },

    async listUsers(ids) {
      if (ids.length === 0) return [];
      const { rows } = await query<UserRow>(
        `SELECT * FROM tc_users WHERE id = ANY($1::text[])`,
        [ids],
      );
      return rows.map(mapUserRow);
    },

    async setUserPlatformRole(userId, role) {
      const { rows } = await query<UserRow>(
        `UPDATE tc_users
         SET platform_role = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [userId, role],
      );
      return rows[0] ? mapUserRow(rows[0]) : null;
    },

    async getMembership(organizationId, userId) {
      const { rows } = await query<MemRow>(
        `SELECT * FROM tc_memberships
         WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );
      return rows[0] ? mapMembership(rows[0]) : null;
    },

    async listMembershipsForUser(userId) {
      const { rows } = await query<MemRow>(
        `SELECT * FROM tc_memberships WHERE user_id = $1`,
        [userId],
      );
      return rows.map(mapMembership);
    },

    async listMembershipsForOrganization(organizationId) {
      const { rows } = await query<MemRow>(
        `SELECT * FROM tc_memberships WHERE organization_id = $1`,
        [organizationId],
      );
      return rows.map(mapMembership);
    },

    async addMembership(input) {
      const existing = await this.getMembership(
        input.organizationId,
        input.userId,
      );
      if (existing) return existing;
      const { rows } = await query<MemRow>(
        `INSERT INTO tc_memberships
           (id, organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING *`,
        [newId("mem"), input.organizationId, input.userId, input.role],
      );
      return mapMembership(rows[0]!);
    },

    async setMembershipRole(organizationId, userId, role) {
      const { rows } = await query<MemRow>(
        `UPDATE tc_memberships
         SET role = $3
         WHERE organization_id = $1 AND user_id = $2
         RETURNING *`,
        [organizationId, userId, role],
      );
      return rows[0] ? mapMembership(rows[0]) : null;
    },

    async createMagicLink(link: MagicLink) {
      await query(
        `INSERT INTO tc_magic_links
           (id, email, token_hash, organization_id, expires_at, consumed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          link.id,
          normalizeEmail(link.email),
          link.tokenHash,
          link.organizationId ?? null,
          link.expiresAt,
          link.consumedAt ?? null,
          link.createdAt,
        ],
      );
    },

    async consumeMagicLink(tokenHash, at) {
      const { rows } = await query<{
        id: string;
        email: string;
        token_hash: string;
        organization_id: string | null;
        expires_at: Date;
        consumed_at: Date | null;
        created_at: Date;
      }>(
        `UPDATE tc_magic_links
         SET consumed_at = $2::timestamptz
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > $2::timestamptz
         RETURNING *`,
        [tokenHash, at],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        tokenHash: row.token_hash,
        organizationId: row.organization_id ?? undefined,
        expiresAt: row.expires_at.toISOString(),
        consumedAt: row.consumed_at?.toISOString(),
        createdAt: row.created_at.toISOString(),
      };
    },

    async createSession(session: Session) {
      await query(
        `INSERT INTO tc_sessions
           (id, user_id, organization_id, expires_at, revoked_at, created_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          session.id,
          session.userId,
          session.organizationId,
          session.expiresAt,
          session.revokedAt ?? null,
          session.createdAt,
          session.userAgent ?? null,
          session.ip ?? null,
        ],
      );
    },

    async getSession(id) {
      const { rows } = await query<{
        id: string;
        user_id: string;
        organization_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        created_at: Date;
        user_agent: string | null;
        ip: string | null;
      }>(`SELECT * FROM tc_sessions WHERE id = $1`, [id]);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        expiresAt: row.expires_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString(),
        createdAt: row.created_at.toISOString(),
        userAgent: row.user_agent ?? undefined,
        ip: row.ip ?? undefined,
      };
    },

    async listSessionsForUser(userId) {
      const { rows } = await query<{
        id: string;
        user_id: string;
        organization_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        created_at: Date;
        user_agent: string | null;
        ip: string | null;
      }>(
        `SELECT * FROM tc_sessions
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [userId],
      );
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        expiresAt: row.expires_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString(),
        createdAt: row.created_at.toISOString(),
        userAgent: row.user_agent ?? undefined,
        ip: row.ip ?? undefined,
      }));
    },

    async revokeSession(id, atIso) {
      await query(
        `UPDATE tc_sessions SET revoked_at = $2::timestamptz
         WHERE id = $1 AND revoked_at IS NULL`,
        [id, atIso],
      );
    },

    async revokeUserSessions(userId, atIso) {
      await query(
        `UPDATE tc_sessions SET revoked_at = $2::timestamptz
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, atIso],
      );
    },

    async claimDemoIdempotencyKey(key, organizationId) {
      try {
        await query(
          `INSERT INTO tc_demo_create_idempotency (idempotency_key, organization_id)
           VALUES ($1, $2)`,
          [key, organizationId],
        );
        return { claimed: true, organizationId };
      } catch {
        const existing = await this.getDemoIdempotency(key);
        return {
          claimed: false,
          organizationId: existing ?? organizationId,
        };
      }
    },

    async getDemoIdempotency(key) {
      const { rows } = await query<{ organization_id: string }>(
        `SELECT organization_id FROM tc_demo_create_idempotency
         WHERE idempotency_key = $1`,
        [key],
      );
      return rows[0]?.organization_id ?? null;
    },
  };
}
