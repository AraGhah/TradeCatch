import { getPgPool } from "@/product/missed-call/postgres-store";
import type { SupportStore } from "./store";
import type { SupportTicket } from "./types";

export function createPostgresSupportStore(connectionString: string): SupportStore {
  const pool = getPgPool(connectionString);
  return {
    async saveTicket(row) {
      await pool.query(
        `INSERT INTO tc_support_tickets (id, organization_id, subject, category, kind, description, priority, status, contact_email, related_call_id, assigned_to, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, priority = EXCLUDED.priority, assigned_to = EXCLUDED.assigned_to, updated_at = EXCLUDED.updated_at`,
        [row.id, row.organizationId, row.subject, row.category, row.kind, row.description, row.priority, row.status, row.contactEmail, row.relatedCallId ?? null, row.assignedTo ?? null, row.createdAt, row.updatedAt],
      );
    },
    async listTickets(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_support_tickets WHERE ($1::text IS NULL OR organization_id = $1) ORDER BY created_at DESC`, [organizationId ?? null]);
      return res.rows.map(ticketFrom);
    },
    async getTicket(id) {
      const res = await pool.query(`SELECT * FROM tc_support_tickets WHERE id = $1`, [id]);
      return res.rows[0] ? ticketFrom(res.rows[0]) : null;
    },
    async saveMessage(row) {
      await pool.query(
        `INSERT INTO tc_support_messages (id, ticket_id, author_role, body, internal, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.ticketId, row.authorRole, row.body, row.internal, row.createdAt],
      );
    },
    async listMessages(ticketId) {
      const res = await pool.query(`SELECT * FROM tc_support_messages WHERE ticket_id = $1 ORDER BY created_at`, [ticketId]);
      return res.rows.map((row) => ({
        id: String(row.id),
        ticketId: String(row.ticket_id),
        authorRole: row.author_role as "contractor" | "admin",
        body: String(row.body),
        internal: Boolean(row.internal),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    },
    async saveAttachment(row) {
      await pool.query(`INSERT INTO tc_support_attachments (id, ticket_id, file_name, created_at) VALUES ($1,$2,$3,$4)`, [row.id, row.ticketId, row.fileName, row.createdAt]);
    },
    async listAttachments(ticketId) {
      const res = await pool.query(`SELECT id, file_name FROM tc_support_attachments WHERE ticket_id = $1`, [ticketId]);
      return res.rows.map((row) => ({ id: String(row.id), fileName: String(row.file_name) }));
    },
    async saveEvent(row) {
      await pool.query(`INSERT INTO tc_support_events (id, ticket_id, action, created_at) VALUES ($1,$2,$3,$4)`, [row.id, row.ticketId, row.action, row.createdAt]);
    },
    async saveAccountRequest(row) {
      await pool.query(
        `INSERT INTO tc_account_requests (id, organization_id, kind, status, phone_routing, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.organizationId, row.kind, row.status, row.phoneRouting, row.createdAt],
      );
    },
    async listAccountRequests(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_account_requests WHERE organization_id = $1 ORDER BY created_at DESC`, [organizationId]);
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        kind: row.kind as "deletion" | "suspension" | "reactivation",
        status: row.status as "requested" | "in_review" | "completed",
        phoneRouting: "unchanged_until_transition" as const,
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    },
    async saveFeedback(row) {
      await pool.query(
        `INSERT INTO tc_customer_feedback (id, organization_id, kind, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [row.id, row.organizationId, row.kind, row.body, row.createdAt],
      );
    },
  };
}

function ticketFrom(row: Record<string, unknown>): SupportTicket {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    subject: String(row.subject),
    category: row.category as SupportTicket["category"],
    kind: (row.kind as SupportTicket["kind"]) || "issue",
    description: String(row.description),
    priority: row.priority as SupportTicket["priority"],
    status: row.status as SupportTicket["status"],
    contactEmail: String(row.contact_email),
    relatedCallId: row.related_call_id ? String(row.related_call_id) : undefined,
    assignedTo: row.assigned_to ? String(row.assigned_to) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
