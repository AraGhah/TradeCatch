import type { BookAuditPayload } from "@/lib/validation/book-audit";
import { isDurableMissedCallStoreConfigured } from "@/lib/config";
import { createId } from "@/lib/id";
import { getPgPool } from "@/product/missed-call/postgres-store";

export type BookAuditConsentRecord = {
  wording: string;
  source: string;
  at: string;
};

export type PersistBookAuditLeadInput = {
  idempotencyKey: string;
  payload: BookAuditPayload;
  consent: BookAuditConsentRecord;
  emailSent: boolean;
  crmForwarded: boolean;
};

export type PersistedBookAuditLead = {
  id: string;
  duplicate: boolean;
  emailSent: boolean;
  crmForwarded: boolean;
};

/** Drop one-time tokens and honeypot fields from durable JSON evidence. */
function sanitizeStoredPayload(
  payload: BookAuditPayload,
): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...payload };
  delete stored.turnstileToken;
  delete stored.companyWebsite;
  return stored;
}

/**
 * Persist a book-audit lead with consent wording/timestamp when durable store
 * is enabled. The lead and its notification outbox are committed atomically.
 * Returns null when Postgres is not configured.
 */
export async function persistBookAuditLead(
  input: PersistBookAuditLeadInput,
): Promise<PersistedBookAuditLead | null> {
  if (!isDurableMissedCallStoreConfigured()) return null;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;

  const pool = getPgPool(url);
  const id = createId("bal");
  const now = new Date().toISOString();

  const inserted = await pool.query<{
    id: string;
    email_sent: boolean;
    crm_forwarded: boolean;
  }>(
    `WITH lead AS (INSERT INTO mc_book_audit_leads (
         id, idempotency_key, email, phone, company, preferred_language,
         service_consent, marketing_consent, consent_wording, consent_source,
         consent_at, payload, email_sent, crm_forwarded, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13,$14,
         $15::timestamptz,$15::timestamptz
       )
       ON CONFLICT (idempotency_key) DO UPDATE
         SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING id, email_sent, crm_forwarded, updated_at
     ), queued AS (
       INSERT INTO mc_book_audit_notifications (lead_id, channel, delivered_at)
       SELECT lead.id, c.channel,
         CASE WHEN (c.channel = 'notify_email' AND lead.email_sent)
                OR (c.channel = 'crm' AND lead.crm_forwarded)
              THEN lead.updated_at ELSE NULL END
       FROM lead
       CROSS JOIN (VALUES ('notify_email'), ('customer_email'), ('crm')) AS c(channel)
       ON CONFLICT DO NOTHING
     )
     SELECT id, email_sent, crm_forwarded FROM lead`,
    [
      id,
      input.idempotencyKey,
      input.payload.email,
      input.payload.phone,
      input.payload.company,
      input.payload.preferredLanguage,
      input.payload.serviceConsent,
      input.payload.marketingConsent,
      input.consent.wording,
      input.consent.source,
      input.consent.at,
      JSON.stringify(sanitizeStoredPayload(input.payload)),
      input.emailSent,
      input.crmForwarded,
      now,
    ],
  );

  if (inserted.rows[0]) {
    return {
      id: inserted.rows[0].id,
      duplicate: inserted.rows[0].id !== id,
      emailSent: inserted.rows[0].email_sent,
      crmForwarded: inserted.rows[0].crm_forwarded,
    };
  }

  throw new Error("book-audit persistence returned no saved lead");
}
