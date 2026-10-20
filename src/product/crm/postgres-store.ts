import type { Pool } from "pg";
import { createPostgresPool } from "@/lib/postgres-pool";
import { createId } from "@/lib/id";
import { phoneKey } from "./phone";
import type { CrmStore, UpsertCustomerInput } from "./store";
import {
  OPEN_LEAD_STATUSES,
  type Conversation,
  type ConversationControl,
  type CrmMessage,
  type Customer,
  type Lead,
  type LeadEvent,
  type LeadPriority,
  type LeadSource,
  type LeadStatus,
  type LeadWithCustomer,
  type MessageDeliveryStatus,
} from "./types";

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = createPostgresPool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function opt(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    firstName: opt(row.first_name),
    lastName: opt(row.last_name),
    displayName: opt(row.display_name),
    phoneE164: String(row.phone_e164),
    email: opt(row.email),
    serviceAddress: opt(row.service_address),
    preferredLanguage: row.preferred_language === "en" ? "en" : "fr",
    allowSms: Boolean(row.allow_sms),
    allowEmail: Boolean(row.allow_email),
    firstContactAt: iso(row.first_contact_at),
    lastContactAt: iso(row.last_contact_at),
    notes: opt(row.notes),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    customerId: String(row.customer_id),
    source: String(row.source) as LeadSource,
    service: opt(row.service),
    description: opt(row.description),
    location: opt(row.location),
    priority: String(row.priority) as LeadPriority,
    status: String(row.status) as LeadStatus,
    assignedToUserId: opt(row.assigned_to_user_id),
    assignedToName: opt(row.assigned_to_name),
    callSessionId: opt(row.call_session_id),
    callSid: opt(row.call_sid),
    missedCallLeadId: opt(row.missed_call_lead_id),
    websiteLeadId: opt(row.website_lead_id),
    conversationId: opt(row.conversation_id),
    urgencyNote: opt(row.urgency_note),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapJoined(row: Record<string, unknown>): LeadWithCustomer {
  const lead = mapLead(row);
  const customer = mapCustomer({
    id: row.c_id,
    organization_id: row.c_organization_id,
    first_name: row.c_first_name,
    last_name: row.c_last_name,
    display_name: row.c_display_name,
    phone_e164: row.c_phone_e164,
    email: row.c_email,
    service_address: row.c_service_address,
    preferred_language: row.c_preferred_language,
    allow_sms: row.c_allow_sms,
    allow_email: row.c_allow_email,
    first_contact_at: row.c_first_contact_at,
    last_contact_at: row.c_last_contact_at,
    notes: row.c_notes,
    created_at: row.c_created_at,
    updated_at: row.c_updated_at,
  });
  return { ...lead, customer };
}

const LEAD_SELECT = `
  l.id, l.organization_id, l.customer_id, l.source, l.service, l.description,
  l.location, l.priority, l.status, l.assigned_to_user_id, l.assigned_to_name,
  l.call_session_id, l.call_sid, l.missed_call_lead_id, l.website_lead_id,
  l.conversation_id, l.urgency_note, l.created_at, l.updated_at,
  c.id AS c_id, c.organization_id AS c_organization_id, c.first_name AS c_first_name,
  c.last_name AS c_last_name, c.display_name AS c_display_name,
  c.phone_e164 AS c_phone_e164, c.email AS c_email,
  c.service_address AS c_service_address,
  c.preferred_language AS c_preferred_language,
  c.allow_sms AS c_allow_sms, c.allow_email AS c_allow_email,
  c.first_contact_at AS c_first_contact_at, c.last_contact_at AS c_last_contact_at,
  c.notes AS c_notes, c.created_at AS c_created_at, c.updated_at AS c_updated_at
`;

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    customerId: String(row.customer_id),
    leadId: opt(row.lead_id),
    channel: row.channel === "call" || row.channel === "mixed" ? row.channel : "sms",
    control: String(row.control) as ConversationControl,
    lastMessageAt: row.last_message_at ? iso(row.last_message_at) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): CrmMessage {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    conversationId: String(row.conversation_id),
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    body: String(row.body),
    fromE164: opt(row.from_e164),
    toE164: opt(row.to_e164),
    automated: Boolean(row.automated),
    deliveryStatus: String(row.delivery_status) as MessageDeliveryStatus,
    providerMessageSid: opt(row.provider_message_sid),
    simulated: Boolean(row.simulated),
    at: iso(row.at),
  };
}

function mapEvent(row: Record<string, unknown>): LeadEvent {
  const payload =
    typeof row.payload === "string"
      ? (JSON.parse(row.payload) as Record<string, unknown>)
      : ((row.payload as Record<string, unknown> | null) ?? undefined);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    leadId: String(row.lead_id),
    kind: String(row.kind),
    detail: opt(row.detail),
    actor: opt(row.actor),
    payload: payload ?? undefined,
    at: iso(row.at),
  };
}

export function createPostgresCrmStore(url: string): CrmStore {
  const pool = getPool(url);

  return {
    async listCustomers(organizationId, limit = 1001) {
      const res = await pool.query('SELECT * FROM tc_customers WHERE organization_id=$1 ORDER BY id LIMIT $2',[organizationId,limit]);
      return res.rows.map(mapCustomer);
    },
    async upsertCustomer(input: UpsertCustomerInput) {
      const id = input.id ?? createId("cus");
      const res = await pool.query(
        `INSERT INTO tc_customers (
           id, organization_id, phone_e164, phone_key, first_name, last_name,
           display_name, email, service_address, preferred_language, allow_sms,
           allow_email, first_contact_at, last_contact_at, notes, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$13,$14
         )
         ON CONFLICT (organization_id, phone_key) DO UPDATE SET
           phone_e164 = EXCLUDED.phone_e164,
           first_name = COALESCE(EXCLUDED.first_name, tc_customers.first_name),
           last_name = COALESCE(EXCLUDED.last_name, tc_customers.last_name),
           display_name = COALESCE(EXCLUDED.display_name, tc_customers.display_name),
           email = COALESCE(EXCLUDED.email, tc_customers.email),
           service_address = COALESCE(EXCLUDED.service_address, tc_customers.service_address),
           preferred_language = EXCLUDED.preferred_language,
           notes = COALESCE(EXCLUDED.notes, tc_customers.notes),
           last_contact_at = EXCLUDED.last_contact_at,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.phoneE164,
          phoneKey(input.phoneE164),
          input.firstName ?? null,
          input.lastName ?? null,
          input.displayName ?? null,
          input.email ?? null,
          input.serviceAddress ?? null,
          input.preferredLanguage,
          input.allowSms ?? true,
          input.allowEmail ?? true,
          input.firstContactAt,
          input.lastContactAt,
          input.notes ?? null,
        ],
      );
      return mapCustomer(res.rows[0]);
    },

    async getCustomer(organizationId, id) {
      const res = await pool.query(
        `SELECT * FROM tc_customers WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return res.rows[0] ? mapCustomer(res.rows[0]) : null;
    },

    async findCustomerByPhone(organizationId, phoneE164) {
      const res = await pool.query(
        `SELECT * FROM tc_customers
         WHERE organization_id = $1 AND phone_key = $2`,
        [organizationId, phoneKey(phoneE164)],
      );
      return res.rows[0] ? mapCustomer(res.rows[0]) : null;
    },

    async updateCustomer(organizationId, id, patch) {
      const current = await pool.query(
        `SELECT * FROM tc_customers WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      if (!current.rows[0]) return null;
      const row = mapCustomer(current.rows[0]);
      const next = { ...row, ...patch, updatedAt: new Date().toISOString() };
      const res = await pool.query(
        `UPDATE tc_customers SET
           first_name = $3, last_name = $4, display_name = $5, email = $6,
           service_address = $7, preferred_language = $8, allow_sms = $9,
           allow_email = $10, notes = $11, last_contact_at = $12, updated_at = $13
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.firstName ?? null,
          next.lastName ?? null,
          next.displayName ?? null,
          next.email ?? null,
          next.serviceAddress ?? null,
          next.preferredLanguage,
          next.allowSms,
          next.allowEmail,
          next.notes ?? null,
          next.lastContactAt,
          next.updatedAt,
        ],
      );
      return res.rows[0] ? mapCustomer(res.rows[0]) : null;
    },

    async insertLead(lead) {
      const res = await pool.query(
        `INSERT INTO tc_leads (
           id, organization_id, customer_id, source, service, description, location,
           priority, status, assigned_to_user_id, assigned_to_name, call_session_id,
           call_sid, missed_call_lead_id, website_lead_id, conversation_id,
           urgency_note, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
         ) RETURNING *`,
        [
          lead.id,
          lead.organizationId,
          lead.customerId,
          lead.source,
          lead.service ?? null,
          lead.description ?? null,
          lead.location ?? null,
          lead.priority,
          lead.status,
          lead.assignedToUserId ?? null,
          lead.assignedToName ?? null,
          lead.callSessionId ?? null,
          lead.callSid ?? null,
          lead.missedCallLeadId ?? null,
          lead.websiteLeadId ?? null,
          lead.conversationId ?? null,
          lead.urgencyNote ?? null,
          lead.createdAt,
          lead.updatedAt,
        ],
      );
      return mapLead(res.rows[0]);
    },

    async getLead(organizationId, id) {
      const res = await pool.query(
        `SELECT ${LEAD_SELECT}
         FROM tc_leads l
         JOIN tc_customers c ON c.id = l.customer_id AND c.organization_id = l.organization_id
         WHERE l.id = $1 AND l.organization_id = $2`,
        [id, organizationId],
      );
      return res.rows[0] ? mapJoined(res.rows[0]) : null;
    },

    async findOpenLead(organizationId, customerId) {
      const res = await pool.query(
        `SELECT * FROM tc_leads
         WHERE organization_id = $1 AND customer_id = $2 AND status = ANY($3::text[])
         ORDER BY created_at DESC
         LIMIT 1`,
        [organizationId, customerId, OPEN_LEAD_STATUSES],
      );
      return res.rows[0] ? mapLead(res.rows[0]) : null;
    },

    async listLeads(organizationId, filters = {}) {
      const limit = Math.min(filters.limit ?? 100, 200);
      const offset = filters.offset ?? 0;
      const res = await pool.query(
        `SELECT ${LEAD_SELECT}
         FROM tc_leads l
         JOIN tc_customers c ON c.id = l.customer_id AND c.organization_id = l.organization_id
         WHERE l.organization_id = $1
           AND ($2::text IS NULL OR l.status = $2)
           AND ($3::text IS NULL OR l.source = $3)
           AND ($4::text IS NULL OR l.priority = $4)
           AND ($5::text IS NULL OR l.assigned_to_user_id = $5)
           AND ($6::timestamptz IS NULL OR l.created_at >= $6)
           AND ($7::timestamptz IS NULL OR l.created_at <= $7)
           AND (
             $8::text IS NULL OR
             c.display_name ILIKE $8 OR c.phone_e164 ILIKE $8 OR
             c.email ILIKE $8 OR l.service ILIKE $8 OR
             l.description ILIKE $8 OR l.location ILIKE $8
           )
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $9 OFFSET $10`,
        [
          organizationId,
          filters.status ?? null,
          filters.source ?? null,
          filters.priority ?? null,
          filters.assignedToUserId ?? null,
          filters.from ?? null,
          filters.to ?? null,
          filters.q?.trim() ? `%${filters.q.trim()}%` : null,
          limit,
          offset,
        ],
      );
      return res.rows.map(mapJoined);
    },

    async updateLead(organizationId, id, patch) {
      const current = await this.getLead(organizationId, id);
      if (!current) return null;
      const next: Lead = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const res = await pool.query(
        `UPDATE tc_leads SET
           service = $3, description = $4, location = $5, priority = $6, status = $7,
           assigned_to_user_id = $8, assigned_to_name = $9, conversation_id = $10,
           urgency_note = $11, call_session_id = $12, call_sid = $13,
           missed_call_lead_id = $14, website_lead_id = $15, updated_at = $16
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.service ?? null,
          next.description ?? null,
          next.location ?? null,
          next.priority,
          next.status,
          next.assignedToUserId ?? null,
          next.assignedToName ?? null,
          next.conversationId ?? null,
          next.urgencyNote ?? null,
          next.callSessionId ?? null,
          next.callSid ?? null,
          next.missedCallLeadId ?? null,
          next.websiteLeadId ?? null,
          next.updatedAt,
        ],
      );
      return res.rows[0] ? mapLead(res.rows[0]) : null;
    },

    async appendEvent(event) {
      const id = event.id ?? createId("lev");
      const at = event.at ?? new Date().toISOString();
      const res = await pool.query(
        `INSERT INTO tc_lead_events
           (id, organization_id, lead_id, kind, detail, actor, payload, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         RETURNING *`,
        [
          id,
          event.organizationId,
          event.leadId,
          event.kind,
          event.detail ?? null,
          event.actor ?? null,
          JSON.stringify(event.payload ?? {}),
          at,
        ],
      );
      return mapEvent(res.rows[0]);
    },

    async listEvents(organizationId, leadId) {
      const res = await pool.query(
        `SELECT * FROM tc_lead_events
         WHERE organization_id = $1 AND lead_id = $2
         ORDER BY at ASC`,
        [organizationId, leadId],
      );
      return res.rows.map(mapEvent);
    },

    async insertConversation(conversation) {
      const res = await pool.query(
        `INSERT INTO tc_conversations (
           id, organization_id, customer_id, lead_id, channel, control,
           last_message_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          conversation.id,
          conversation.organizationId,
          conversation.customerId,
          conversation.leadId ?? null,
          conversation.channel,
          conversation.control,
          conversation.lastMessageAt ?? null,
          conversation.createdAt,
          conversation.updatedAt,
        ],
      );
      return mapConversation(res.rows[0]);
    },

    async getConversation(organizationId, id) {
      const res = await pool.query(
        `SELECT * FROM tc_conversations WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return res.rows[0] ? mapConversation(res.rows[0]) : null;
    },

    async findConversationForLead(organizationId, leadId) {
      const res = await pool.query(
        `SELECT * FROM tc_conversations
         WHERE organization_id = $1 AND lead_id = $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [organizationId, leadId],
      );
      return res.rows[0] ? mapConversation(res.rows[0]) : null;
    },

    async findLatestConversation(organizationId, customerId) {
      const res = await pool.query(
        `SELECT * FROM tc_conversations
         WHERE organization_id = $1 AND customer_id = $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [organizationId, customerId],
      );
      return res.rows[0] ? mapConversation(res.rows[0]) : null;
    },

    async listConversations(organizationId, limit) {
      const res = await pool.query(
        `SELECT * FROM tc_conversations
         WHERE organization_id = $1
         ORDER BY updated_at DESC LIMIT $2`,
        [organizationId,limit ?? null],
      );
      return res.rows.map(mapConversation);
    },

    async updateConversation(organizationId, id, patch) {
      const current = await this.getConversation(organizationId, id);
      if (!current) return null;
      const next: Conversation = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const res = await pool.query(
        `UPDATE tc_conversations SET
           lead_id = $3, channel = $4, control = $5, last_message_at = $6, updated_at = $7
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.leadId ?? null,
          next.channel,
          next.control,
          next.lastMessageAt ?? null,
          next.updatedAt,
        ],
      );
      return res.rows[0] ? mapConversation(res.rows[0]) : null;
    },

    async appendMessage(message) {
      const id = message.id ?? createId("msg");
      const at = message.at ?? new Date().toISOString();
      const res = await pool.query(
        `INSERT INTO tc_crm_messages (
           id, organization_id, conversation_id, direction, body, from_e164, to_e164,
           automated, delivery_status, provider_message_sid, simulated, at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (provider_message_sid) WHERE provider_message_sid IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
          id,
          message.organizationId,
          message.conversationId,
          message.direction,
          message.body,
          message.fromE164 ?? null,
          message.toE164 ?? null,
          message.automated,
          message.deliveryStatus,
          message.providerMessageSid ?? null,
          message.simulated,
          at,
        ],
      );
      return res.rows[0] ? mapMessage(res.rows[0]) : null;
    },

    async listMessages(organizationId, conversationId, limit) {
      const res = await pool.query(
        `SELECT * FROM tc_crm_messages
         WHERE organization_id = $1 AND conversation_id = $2
         ORDER BY at ASC LIMIT $3`,
        [organizationId, conversationId,limit ?? null],
      );
      return res.rows.map(mapMessage);
    },

    async latestMessage(organizationId, conversationId) {
      const res = await pool.query(
        `SELECT * FROM tc_crm_messages
         WHERE organization_id = $1 AND conversation_id = $2
         ORDER BY at DESC
         LIMIT 1`,
        [organizationId, conversationId],
      );
      return res.rows[0] ? mapMessage(res.rows[0]) : null;
    },

    async clearOrganization(organizationId) {
      await pool.query(`DELETE FROM tc_customers WHERE organization_id = $1`, [
        organizationId,
      ]);
      await pool.query(
        `DELETE FROM tc_lead_events WHERE organization_id = $1`,
        [organizationId],
      );
      await pool.query(
        `DELETE FROM tc_crm_messages WHERE organization_id = $1`,
        [organizationId],
      );
    },
  };
}
