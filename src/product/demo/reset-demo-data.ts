import { getPgPool } from "@/product/missed-call/postgres-store";
import { demoClientAccount } from "@/product/missed-call/fixtures";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

/**
 * Tables wiped on a staging demo reset. Order does not matter when using
 * TRUNCATE … CASCADE; listed explicitly so we never touch schema migrations.
 */
export const DEMO_RESET_TABLES = [
  // Missed-call / Module A
  "mc_technician_alerts",
  "mc_leads",
  "mc_audit_events",
  "mc_outbound_messages",
  "mc_inbound_message_sids",
  "mc_sms_suppressions",
  "mc_workflows",
  "mc_calls",
  "mc_book_audit_leads",
  "mc_clients",
  "mc_ops_meta",
  // SaaS
  "tc_sessions",
  "tc_magic_links",
  "tc_memberships",
  "tc_users",
  "tc_org_api_keys",
  "tc_inbox_items",
  "tc_quote_messages",
  "tc_quote_threads",
  "tc_website_leads",
  "tc_appointments",
  "tc_pipeline_cards",
  "tc_revenue_events",
  "tc_review_requests",
  "tc_timeline_events",
  "tc_crm_dlq",
  "tc_org_settings",
  "tc_organizations",
  // Receptionist
  "rc_call_sessions",
  "rc_profiles",
  // Email automation
  "em_enrollments",
  "em_suppressions",
  "em_sequences",
  "em_templates",
  "em_org_settings",
] as const;

export const DEMO_RESET_CONFIRMATION = "RESET_DEMO_DATA";

export type DemoResetResult = {
  ok: true;
  truncatedTables: string[];
  seededClientId: string;
  mode: "postgres" | "memory";
};

/**
 * Wipe fictional staging data and re-seed the demo missed-call client.
 * Must only be invoked from staging-gated ops endpoints.
 */
export async function resetDemoData(
  databaseUrl = process.env.DATABASE_URL?.trim(),
): Promise<DemoResetResult> {
  if (databaseUrl && process.env.MISSED_CALL_DURABLE_STORE === "1") {
    const pool = getPgPool(databaseUrl);
    const existing = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [DEMO_RESET_TABLES],
    );
    const tables = existing.rows.map((row) => row.tablename);
    if (tables.length > 0) {
      // CASCADE clears dependent rows; RESTART IDENTITY resets serials.
      await pool.query(
        `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }

    const { store } = await ensureMissedCallReady();
    // Runtime may still hold a stale in-process client from before truncate —
    // always re-save the canonical demo fixture.
    const client = demoClientAccount({
      id: process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo",
    });
    await store.saveClient(client);

    return {
      ok: true,
      truncatedTables: tables,
      seededClientId: client.id,
      mode: "postgres",
    };
  }

  // In-memory / local staging without durable store: re-seed only.
  const { store } = await ensureMissedCallReady();
  const client = demoClientAccount({
    id: process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo",
  });
  await store.saveClient(client);

  return {
    ok: true,
    truncatedTables: [],
    seededClientId: client.id,
    mode: "memory",
  };
}
