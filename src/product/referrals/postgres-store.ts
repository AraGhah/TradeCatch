import type { Pool } from "pg";
import { getPgPool } from "@/product/missed-call/postgres-store";
import {
  DEFAULT_REFERRAL_SETTINGS,
  type FulfillmentMethod,
  type ReferralEvent,
  type ReferralEventAction,
  type ReferralRecord,
  type ReferralSettings,
  type RejectionReason,
  type ReviewFlag,
  type RewardRecord,
} from "./model";
import { ReferralConflictError, type ReferralStore } from "./store";
import type { PlanId } from "@/product/saas/plan-catalog";

/**
 * PostgreSQL-backed referral store. Every statement is parameterised, and every
 * state change that matters is a single conditional UPDATE or an INSERT guarded
 * by a unique constraint, so two concurrent requests (a replayed webhook, two
 * administrators) cannot both win. The constraints live in schema.sql.
 */

const GIFT_CARD_INDEX = "tc_referral_rewards_gift_card_reference";

type Row = Record<string, unknown>;

const iso = (value: unknown): string | undefined =>
  value == null ? undefined : new Date(value as string | Date).toISOString();
const isoRequired = (value: unknown): string => iso(value) ?? new Date(0).toISOString();
const text = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);

const REFERRAL_COLUMNS = `id,
  referrer_organization_id, referred_organization_id,
  referrer_business_name, referred_business_name, code, status, rejection_reason,
  review_flags, registered_at, qualified_at, updated_at`;

const REWARD_COLUMNS = `id, referral_id, referrer_organization_id, referred_organization_id,
  plan, amount_cents, currency, status, livemode, qualifying_session_id,
  qualifying_payment_intent_id, eligible_at, review_flags, rejection_reason,
  decided_by, decided_at, decision_note, fulfillment_method, gift_card_reference,
  issued_by, issued_at, created_at, updated_at`;

function mapReferral(row: Row): ReferralRecord {
  return {
    id: String(row.id),
    referrerOrganizationId: String(row.referrer_organization_id),
    referredOrganizationId: String(row.referred_organization_id),
    referrerBusinessName: String(row.referrer_business_name),
    referredBusinessName: String(row.referred_business_name),
    code: String(row.code),
    status: row.status as ReferralRecord["status"],
    rejectionReason: (text(row.rejection_reason) as RejectionReason | undefined) ?? undefined,
    reviewFlags: ((row.review_flags as string[] | null) ?? []) as ReviewFlag[],
    registeredAt: isoRequired(row.registered_at),
    qualifiedAt: iso(row.qualified_at),
    updatedAt: isoRequired(row.updated_at),
  };
}

function mapReward(row: Row): RewardRecord {
  return {
    id: String(row.id),
    referralId: String(row.referral_id),
    referrerOrganizationId: String(row.referrer_organization_id),
    referredOrganizationId: String(row.referred_organization_id),
    plan: row.plan as PlanId,
    amountCents: Number(row.amount_cents),
    currency: "CAD",
    status: row.status as RewardRecord["status"],
    livemode: Boolean(row.livemode),
    qualifyingSessionId: String(row.qualifying_session_id),
    qualifyingPaymentIntentId: text(row.qualifying_payment_intent_id),
    eligibleAt: isoRequired(row.eligible_at),
    reviewFlags: ((row.review_flags as string[] | null) ?? []) as ReviewFlag[],
    rejectionReason: text(row.rejection_reason) as RejectionReason | undefined,
    decidedBy: text(row.decided_by),
    decidedAt: iso(row.decided_at),
    decisionNote: text(row.decision_note),
    fulfillmentMethod: text(row.fulfillment_method) as FulfillmentMethod | undefined,
    giftCardReference: text(row.gift_card_reference),
    issuedBy: text(row.issued_by),
    issuedAt: iso(row.issued_at),
    createdAt: isoRequired(row.created_at),
    updatedAt: isoRequired(row.updated_at),
  };
}

function mapEvent(row: Row): ReferralEvent {
  return {
    id: String(row.id),
    referralId: text(row.referral_id),
    rewardId: text(row.reward_id),
    actor: String(row.actor),
    action: row.action as ReferralEventAction,
    detail: text(row.detail),
    at: isoRequired(row.at),
  };
}

function mapSettings(row: Row): ReferralSettings {
  return {
    programEnabled: Boolean(row.program_enabled),
    rewardsCents: {
      starter: Number(row.reward_starter_cents),
      growth: Number(row.reward_growth_cents),
      receptionist: Number(row.reward_receptionist_cents),
    },
    eligiblePlans: ((row.eligible_plans as string[]) ?? []) as PlanId[],
    holdDays: Number(row.hold_days),
    requireReferrerActive: Boolean(row.require_referrer_active),
    fulfillmentMethod: row.fulfillment_method as FulfillmentMethod,
    updatedBy: text(row.updated_by),
    updatedAt: iso(row.updated_at),
  };
}

function uniqueViolation(err: unknown, constraint?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string };
  return e.code === "23505" && (constraint === undefined || e.constraint === constraint);
}

const clampLimit = (limit: number | undefined, fallback: number) =>
  Math.min(Math.max(Math.trunc(limit ?? fallback), 1), 500);

export function createPostgresReferralStore(pool: Pool): ReferralStore {
  async function referralById(id: string) {
    const { rows } = await pool.query(
      `SELECT ${REFERRAL_COLUMNS} FROM tc_referrals WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapReferral(rows[0]) : null;
  }
  async function rewardBy(
    column:
      | "id"
      | "referral_id"
      | "referred_organization_id"
      | "qualifying_session_id"
      | "qualifying_payment_intent_id",
    value: string,
  ) {
    const { rows } = await pool.query(
      `SELECT ${REWARD_COLUMNS} FROM tc_referral_rewards WHERE ${column} = $1`,
      [value],
    );
    return rows[0] ? mapReward(rows[0]) : null;
  }

  async function codeFor(organizationId: string) {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT code FROM tc_referral_codes WHERE organization_id = $1`,
      [organizationId],
    );
    return rows[0]?.code ?? null;
  }
  async function referralByReferred(organizationId: string) {
    const { rows } = await pool.query(
      `SELECT ${REFERRAL_COLUMNS} FROM tc_referrals WHERE referred_organization_id = $1`,
      [organizationId],
    );
    return rows[0] ? mapReferral(rows[0]) : null;
  }

  return {
    async getSettings() {
      try {
        const { rows } = await pool.query(`SELECT * FROM tc_referral_settings WHERE id = 1`);
        // No row yet: the catalog's defaults apply until an administrator saves.
        return rows[0] ? mapSettings(rows[0]) : structuredClone(DEFAULT_REFERRAL_SETTINGS);
      } catch (error) {
        // Schema not applied yet (undefined_table) — published defaults still work.
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code === "42P01") {
          return structuredClone(DEFAULT_REFERRAL_SETTINGS);
        }
        throw error;
      }
    },
    async saveSettings(s) {
      const { rows } = await pool.query(
        `INSERT INTO tc_referral_settings (
           id, program_enabled, reward_starter_cents, reward_growth_cents,
           reward_receptionist_cents, eligible_plans, hold_days,
           require_referrer_active, fulfillment_method, updated_by, updated_at
         ) VALUES (1, $1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           program_enabled = EXCLUDED.program_enabled,
           reward_starter_cents = EXCLUDED.reward_starter_cents,
           reward_growth_cents = EXCLUDED.reward_growth_cents,
           reward_receptionist_cents = EXCLUDED.reward_receptionist_cents,
           eligible_plans = EXCLUDED.eligible_plans,
           hold_days = EXCLUDED.hold_days,
           require_referrer_active = EXCLUDED.require_referrer_active,
           fulfillment_method = EXCLUDED.fulfillment_method,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          s.programEnabled,
          s.rewardsCents.starter,
          s.rewardsCents.growth,
          s.rewardsCents.receptionist,
          s.eligiblePlans,
          s.holdDays,
          s.requireReferrerActive,
          s.fulfillmentMethod,
          s.updatedBy ?? null,
          s.updatedAt ?? new Date().toISOString(),
        ],
      );
      return mapSettings(rows[0]!);
    },

    getCodeForOrganization: codeFor,
    async createCode(organizationId, code, at) {
      try {
        const { rows } = await pool.query<{ code: string }>(
          `INSERT INTO tc_referral_codes (organization_id, code, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id) DO NOTHING
           RETURNING code`,
          [organizationId, code, at],
        );
        if (rows[0]) return { code: rows[0].code, created: true };
      } catch (err) {
        if (!uniqueViolation(err)) throw err;
        // Either this organization raced us to a code, or the code itself is taken.
        const raced = await codeFor(organizationId);
        if (raced) return { code: raced, created: false };
        throw new ReferralConflictError("code", "Referral code already in use");
      }
      const existing = await codeFor(organizationId);
      if (!existing) throw new ReferralConflictError("code", "Referral code already in use");
      return { code: existing, created: false };
    },
    async findOrganizationByCode(code) {
      const { rows } = await pool.query<{ organization_id: string }>(
        `SELECT organization_id FROM tc_referral_codes WHERE code = $1`,
        [code],
      );
      return rows[0]?.organization_id ?? null;
    },

    async insertReferral(r) {
      const { rows } = await pool.query(
        `INSERT INTO tc_referrals (
           id, referrer_organization_id, referred_organization_id,
           referrer_business_name, referred_business_name, code, status,
           rejection_reason, review_flags, registered_at, qualified_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12)
         ON CONFLICT (referred_organization_id) DO NOTHING
         RETURNING ${REFERRAL_COLUMNS}`,
        [
          r.id,
          r.referrerOrganizationId,
          r.referredOrganizationId,
          r.referrerBusinessName,
          r.referredBusinessName,
          r.code,
          r.status,
          r.rejectionReason ?? null,
          r.reviewFlags,
          r.registeredAt,
          r.qualifiedAt ?? null,
          r.updatedAt,
        ],
      );
      if (rows[0]) return { created: true, record: mapReferral(rows[0]) };
      const existing = await referralByReferred(r.referredOrganizationId);
      if (!existing) throw new Error("Referral insert conflicted but no row exists");
      return { created: false, record: existing };
    },
    getReferral: referralById,
    getReferralByReferred: referralByReferred,
    async listReferralsForReferrer(organizationId) {
      const { rows } = await pool.query(
        `SELECT ${REFERRAL_COLUMNS} FROM tc_referrals
         WHERE referrer_organization_id = $1
         ORDER BY registered_at DESC, id LIMIT 500`,
        [organizationId],
      );
      return rows.map(mapReferral);
    },
    async listReferrals(filter) {
      const { rows } = await pool.query(
        `SELECT ${REFERRAL_COLUMNS} FROM tc_referrals
         WHERE ($1::text IS NULL OR status = $1)
         ORDER BY registered_at DESC, id LIMIT $2`,
        [filter?.status ?? null, clampLimit(filter?.limit, 200)],
      );
      return rows.map(mapReferral);
    },
    async updateReferral(id, patch) {
      const { rows } = await pool.query(
        `UPDATE tc_referrals SET
           status = COALESCE($2, status),
           rejection_reason = COALESCE($3, rejection_reason),
           review_flags = COALESCE($4::text[], review_flags),
           qualified_at = COALESCE($5, qualified_at),
           updated_at = COALESCE($6, now())
         WHERE id = $1
         RETURNING ${REFERRAL_COLUMNS}`,
        [
          id,
          patch.status ?? null,
          patch.rejectionReason ?? null,
          patch.reviewFlags ?? null,
          patch.qualifiedAt ?? null,
          patch.updatedAt ?? null,
        ],
      );
      return rows[0] ? mapReferral(rows[0]) : null;
    },

    async insertReward(w) {
      const { rows } = await pool.query(
        `INSERT INTO tc_referral_rewards (
           id, referral_id, referrer_organization_id, referred_organization_id,
           plan, amount_cents, currency, status, livemode, qualifying_session_id,
           qualifying_payment_intent_id, eligible_at, review_flags, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,$15)
         ON CONFLICT DO NOTHING
         RETURNING ${REWARD_COLUMNS}`,
        [
          w.id,
          w.referralId,
          w.referrerOrganizationId,
          w.referredOrganizationId,
          w.plan,
          w.amountCents,
          w.currency,
          w.status,
          w.livemode,
          w.qualifyingSessionId,
          w.qualifyingPaymentIntentId ?? null,
          w.eligibleAt,
          w.reviewFlags,
          w.createdAt,
          w.updatedAt,
        ],
      );
      if (rows[0]) return { created: true, reward: mapReward(rows[0]) };
      // Lost to the unique constraints: hand back the reward that already exists.
      const existing =
        (await rewardBy("referral_id", w.referralId)) ??
        (await rewardBy("referred_organization_id", w.referredOrganizationId)) ??
        (await rewardBy("qualifying_session_id", w.qualifyingSessionId));
      if (!existing) throw new Error("Reward insert conflicted but no row exists");
      return { created: false, reward: existing };
    },
    getReward: (id) => rewardBy("id", id),
    getRewardByReferral: (referralId) => rewardBy("referral_id", referralId),
    getRewardByReferredOrganization: (organizationId) =>
      rewardBy("referred_organization_id", organizationId),
    getRewardByPaymentIntent: (paymentIntentId) =>
      rewardBy("qualifying_payment_intent_id", paymentIntentId),
    async listRewardsForReferrer(organizationId) {
      const { rows } = await pool.query(
        `SELECT ${REWARD_COLUMNS} FROM tc_referral_rewards
         WHERE referrer_organization_id = $1
         ORDER BY created_at DESC, id LIMIT 500`,
        [organizationId],
      );
      return rows.map(mapReward);
    },
    async listRewards(filter) {
      const { rows } = await pool.query(
        `SELECT ${REWARD_COLUMNS} FROM tc_referral_rewards
         WHERE ($1::text IS NULL OR status = $1)
         ORDER BY created_at DESC, id LIMIT $2`,
        [filter?.status ?? null, clampLimit(filter?.limit, 200)],
      );
      return rows.map(mapReward);
    },
    async transitionReward(id, t) {
      const p = t.patch ?? {};
      try {
        // One conditional UPDATE: it only matches while the reward is still in
        // a `from` state, so the loser of a race gets zero rows back.
        const { rows } = await pool.query(
          `UPDATE tc_referral_rewards SET
             status = $3,
             updated_at = $4,
             decided_by = COALESCE($5, decided_by),
             decided_at = COALESCE($6, decided_at),
             decision_note = COALESCE($7, decision_note),
             rejection_reason = COALESCE($8, rejection_reason),
             fulfillment_method = COALESCE($9, fulfillment_method),
             gift_card_reference = COALESCE($10, gift_card_reference),
             issued_by = COALESCE($11, issued_by),
             issued_at = COALESCE($12, issued_at),
             review_flags = COALESCE($13::text[], review_flags)
           WHERE id = $1 AND status = ANY($2::text[])
           RETURNING ${REWARD_COLUMNS}`,
          [
            id,
            [...t.from],
            t.to,
            t.at,
            p.decidedBy ?? null,
            p.decidedAt ?? null,
            p.decisionNote ?? null,
            p.rejectionReason ?? null,
            p.fulfillmentMethod ?? null,
            p.giftCardReference ?? null,
            p.issuedBy ?? null,
            p.issuedAt ?? null,
            p.reviewFlags ?? null,
          ],
        );
        return rows[0] ? mapReward(rows[0]) : null;
      } catch (err) {
        if (uniqueViolation(err, GIFT_CARD_INDEX)) {
          throw new ReferralConflictError(
            "gift_card_reference",
            "Gift card reference already recorded on another reward",
          );
        }
        throw err;
      }
    },
    async addRewardFlags(id, flags, at) {
      const { rows } = await pool.query(
        `UPDATE tc_referral_rewards SET
           review_flags = (
             SELECT COALESCE(array_agg(DISTINCT f), '{}')
             FROM unnest(review_flags || $2::text[]) AS f
           ),
           updated_at = $3
         WHERE id = $1
         RETURNING ${REWARD_COLUMNS}`,
        [id, flags, at],
      );
      return rows[0] ? mapReward(rows[0]) : null;
    },

    async addEvent(e) {
      await pool.query(
        `INSERT INTO tc_referral_events (id, referral_id, reward_id, actor, action, detail, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.referralId ?? null, e.rewardId ?? null, e.actor, e.action, e.detail ?? null, e.at],
      );
    },
    async listEvents(filter) {
      const { rows } = await pool.query(
        `SELECT id, referral_id, reward_id, actor, action, detail, at
         FROM tc_referral_events
         WHERE ($1::text IS NULL OR referral_id = $1)
           AND ($2::text IS NULL OR reward_id = $2)
         ORDER BY at DESC, id LIMIT $3`,
        [filter.referralId ?? null, filter.rewardId ?? null, clampLimit(filter.limit, 100)],
      );
      return rows.map(mapEvent);
    },
  };
}

export function postgresReferralStore(url = process.env.DATABASE_URL): ReferralStore {
  if (!url?.trim()) throw new Error("The referral program requires PostgreSQL");
  return createPostgresReferralStore(getPgPool(url.trim()));
}
