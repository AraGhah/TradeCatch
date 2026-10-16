import { Pool } from "pg";
import type { PlanId } from "@/product/saas/entitlements";
import type {
  ActivationCheck,
  IntegrationVerification,
  OnboardingEvent,
  OnboardingSession,
  OnboardingStatus,
  OnboardingStepId,
  OnboardingStepRecord,
  StepStatus,
  VerificationKind,
  VerificationStatus,
} from "./types";
import type { OnboardingStore } from "./store";

function mapSession(row: Record<string, unknown>): OnboardingSession {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    status: row.status as OnboardingStatus,
    currentStep: row.current_step as OnboardingStepId,
    plan: row.plan as PlanId,
    draft:
      row.draft_json && typeof row.draft_json === "object"
        ? (row.draft_json as Record<string, unknown>)
        : {},
    activatedAt: row.activated_at
      ? new Date(String(row.activated_at)).toISOString()
      : null,
    deactivatedAt: row.deactivated_at
      ? new Date(String(row.deactivated_at)).toISOString()
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresOnboardingStore(databaseUrl: string): OnboardingStore {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async getSession(businessId) {
      const res = await pool.query(
        `SELECT * FROM tc_onboarding_sessions WHERE business_id = $1`,
        [businessId],
      );
      return res.rows[0] ? mapSession(res.rows[0]) : null;
    },
    async saveSession(row) {
      await pool.query(
        `INSERT INTO tc_onboarding_sessions (
           id, business_id, status, current_step, plan, draft_json,
           activated_at, deactivated_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
         ON CONFLICT (business_id) DO UPDATE SET
           id = EXCLUDED.id,
           status = EXCLUDED.status,
           current_step = EXCLUDED.current_step,
           plan = EXCLUDED.plan,
           draft_json = EXCLUDED.draft_json,
           activated_at = EXCLUDED.activated_at,
           deactivated_at = EXCLUDED.deactivated_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.businessId,
          row.status,
          row.currentStep,
          row.plan,
          JSON.stringify(row.draft),
          row.activatedAt,
          row.deactivatedAt,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return row;
    },
    async getStep(businessId, stepId) {
      const res = await pool.query(
        `SELECT * FROM tc_onboarding_steps WHERE business_id = $1 AND step_id = $2`,
        [businessId, stepId],
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        businessId: String(row.business_id),
        stepId: row.step_id as OnboardingStepId,
        status: row.status as StepStatus,
        required: Boolean(row.required),
        payload: (row.payload_json ?? {}) as Record<string, unknown>,
        lastError: row.last_error ? String(row.last_error) : null,
        completedAt: row.completed_at
          ? new Date(String(row.completed_at)).toISOString()
          : null,
        verifiedAt: row.verified_at
          ? new Date(String(row.verified_at)).toISOString()
          : null,
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    },
    async listSteps(businessId) {
      const res = await pool.query(
        `SELECT * FROM tc_onboarding_steps WHERE business_id = $1`,
        [businessId],
      );
      return res.rows.map((row) => ({
        businessId: String(row.business_id),
        stepId: row.step_id as OnboardingStepId,
        status: row.status as StepStatus,
        required: Boolean(row.required),
        payload: (row.payload_json ?? {}) as Record<string, unknown>,
        lastError: row.last_error ? String(row.last_error) : null,
        completedAt: row.completed_at
          ? new Date(String(row.completed_at)).toISOString()
          : null,
        verifiedAt: row.verified_at
          ? new Date(String(row.verified_at)).toISOString()
          : null,
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      }));
    },
    async saveStep(row) {
      await pool.query(
        `INSERT INTO tc_onboarding_steps (
           business_id, step_id, status, required, payload_json,
           last_error, completed_at, verified_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
         ON CONFLICT (business_id, step_id) DO UPDATE SET
           status = EXCLUDED.status,
           required = EXCLUDED.required,
           payload_json = EXCLUDED.payload_json,
           last_error = EXCLUDED.last_error,
           completed_at = EXCLUDED.completed_at,
           verified_at = EXCLUDED.verified_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.businessId,
          row.stepId,
          row.status,
          row.required,
          JSON.stringify(row.payload),
          row.lastError,
          row.completedAt,
          row.verifiedAt,
          row.updatedAt,
        ],
      );
    },
    async getVerification(businessId, kind) {
      const res = await pool.query(
        `SELECT * FROM tc_integration_verifications WHERE business_id = $1 AND kind = $2`,
        [businessId, kind],
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        id: String(row.id),
        businessId: String(row.business_id),
        kind: row.kind as VerificationKind,
        status: row.status as VerificationStatus,
        detail: (row.detail_json ?? {}) as Record<string, unknown>,
        error: row.error ? String(row.error) : null,
        verifiedAt: row.verified_at
          ? new Date(String(row.verified_at)).toISOString()
          : null,
        expiresAt: row.expires_at
          ? new Date(String(row.expires_at)).toISOString()
          : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    },
    async listVerifications(businessId) {
      const res = await pool.query(
        `SELECT * FROM tc_integration_verifications WHERE business_id = $1`,
        [businessId],
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        businessId: String(row.business_id),
        kind: row.kind as VerificationKind,
        status: row.status as VerificationStatus,
        detail: (row.detail_json ?? {}) as Record<string, unknown>,
        error: row.error ? String(row.error) : null,
        verifiedAt: row.verified_at
          ? new Date(String(row.verified_at)).toISOString()
          : null,
        expiresAt: row.expires_at
          ? new Date(String(row.expires_at)).toISOString()
          : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      }));
    },
    async saveVerification(row) {
      await pool.query(
        `INSERT INTO tc_integration_verifications (
           id, business_id, kind, status, detail_json, error,
           verified_at, expires_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         ON CONFLICT (business_id, kind) DO UPDATE SET
           id = EXCLUDED.id,
           status = EXCLUDED.status,
           detail_json = EXCLUDED.detail_json,
           error = EXCLUDED.error,
           verified_at = EXCLUDED.verified_at,
           expires_at = EXCLUDED.expires_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.businessId,
          row.kind,
          row.status,
          JSON.stringify(row.detail),
          row.error,
          row.verifiedAt,
          row.expiresAt,
          row.createdAt,
          row.updatedAt,
        ],
      );
    },
    async listActivationChecks(businessId) {
      const res = await pool.query(
        `SELECT * FROM tc_activation_checks WHERE business_id = $1`,
        [businessId],
      );
      return res.rows.map(
        (row): ActivationCheck => ({
          id: String(row.id),
          businessId: String(row.business_id),
          checkId: row.check_id,
          required: Boolean(row.required),
          passed: Boolean(row.passed),
          blocking: Boolean(row.blocking),
          label: String(row.label),
          detail: row.detail ? String(row.detail) : null,
          updatedAt: new Date(String(row.updated_at)).toISOString(),
        }),
      );
    },
    async saveActivationCheck(row) {
      await pool.query(
        `INSERT INTO tc_activation_checks (
           id, business_id, check_id, required, passed, blocking, label, detail, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (business_id, check_id) DO UPDATE SET
           id = EXCLUDED.id,
           required = EXCLUDED.required,
           passed = EXCLUDED.passed,
           blocking = EXCLUDED.blocking,
           label = EXCLUDED.label,
           detail = EXCLUDED.detail,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.businessId,
          row.checkId,
          row.required,
          row.passed,
          row.blocking,
          row.label,
          row.detail,
          row.updatedAt,
        ],
      );
    },
    async addEvent(row) {
      await pool.query(
        `INSERT INTO tc_onboarding_events (
           id, business_id, actor_user_id, action, detail_json, created_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          row.id,
          row.businessId,
          row.actorUserId,
          row.action,
          JSON.stringify(row.detail),
          row.createdAt,
        ],
      );
    },
    async listEvents(businessId) {
      const res = await pool.query(
        `SELECT * FROM tc_onboarding_events WHERE business_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [businessId],
      );
      return res.rows.map(
        (row): OnboardingEvent => ({
          id: String(row.id),
          businessId: String(row.business_id),
          actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
          action: String(row.action),
          detail: (row.detail_json ?? {}) as Record<string, unknown>,
          createdAt: new Date(String(row.created_at)).toISOString(),
        }),
      );
    },
  };
}
