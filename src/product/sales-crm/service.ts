import {
  isDurableMissedCallStoreConfigured,
  isLeadsWebhookConfigured,
} from "@/lib/config";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { SalesLead } from "./types";

function database() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || !isDurableMissedCallStoreConfigured())
    throw new Error("Native sales CRM requires PostgreSQL");
  return getPgPool(url);
}

/** Bounded catch-up for bookings accepted by an older worker during rollout.
 * Cancellation is distinct from delivery and preserves attempts and error history.
 * Re-enabling the explicitly configured optional webhook resumes its own jobs. */
export async function reconcileBookingSalesLeads(leadId?: string, limit = 25) {
  const db = database();
  const batch = Math.min(100, Math.max(1, limit));
  await db.query(
    `INSERT INTO tc_platform_sales_leads (lead_id)
     SELECT l.id FROM mc_book_audit_leads l
     WHERE ($1::text IS NULL OR l.id = $1)
       AND COALESCE(l.payload->>'retention_state', '') NOT IN ('purged_pending','purged')
       AND NOT EXISTS (SELECT 1 FROM tc_platform_sales_leads s WHERE s.lead_id=l.id)
     ORDER BY l.created_at, l.id LIMIT $2
     ON CONFLICT (lead_id) DO NOTHING`,
    [leadId ?? null, batch],
  );
  await db.query(
    `WITH candidates AS (
       SELECT lead_id, channel FROM mc_book_audit_notifications
       WHERE channel='crm' AND delivered_at IS NULL
         AND (leased_until IS NULL OR leased_until <= now())
         AND ($1::text IS NULL OR lead_id=$1)
         AND (($2::boolean AND cancel_reason='external_crm_not_configured')
           OR (NOT $2::boolean AND cancelled_at IS NULL))
       ORDER BY next_attempt_at, lead_id LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE mc_book_audit_notifications j
     SET cancelled_at = CASE WHEN $2 THEN NULL ELSE now() END,
         cancel_reason = CASE WHEN $2 THEN NULL ELSE 'external_crm_not_configured' END,
         lease_token=NULL, leased_until=NULL
     FROM candidates c WHERE j.lead_id=c.lead_id AND j.channel=c.channel`,
    [leadId ?? null, isLeadsWebhookConfigured(), batch],
  );
}

/** Server-only platform data. Never call a contractor CRM capture/list service. */
export async function listSalesLeads(page = 1) {
  const limit = 50;
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    throw new Error("Invalid sales page");
  const result = await database().query<{
    id: string;
    company: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    city: string;
    trade: string;
    preferred_language: "en" | "fr";
    main_problem: string;
    stage: SalesLead["stage"];
    created_at: Date;
  }>(
    `SELECT l.id, l.company, l.email, l.phone, l.preferred_language, l.created_at,
       l.payload->>'firstName' AS first_name, l.payload->>'lastName' AS last_name,
       l.payload->>'city' AS city, l.payload->>'trade' AS trade,
       l.payload->>'mainProblem' AS main_problem, s.stage
     FROM tc_platform_sales_leads s JOIN mc_book_audit_leads l ON l.id=s.lead_id
     WHERE COALESCE(l.payload->>'retention_state', '') NOT IN ('purged_pending','purged')
     ORDER BY l.created_at DESC, l.id DESC LIMIT $1 OFFSET $2`,
    [limit + 1, (page - 1) * limit],
  );
  return {
    leads: result.rows.slice(0, limit).map((row): SalesLead => ({
      id: row.id,
      company: row.company,
      email: row.email,
      phone: row.phone,
      firstName: row.first_name ?? "",
      lastName: row.last_name ?? "",
      city: row.city ?? "",
      trade: row.trade ?? "",
      language: row.preferred_language,
      mainProblem: row.main_problem ?? "",
      stage: row.stage,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    page,
    hasMore: result.rows.length > limit,
  };
}
