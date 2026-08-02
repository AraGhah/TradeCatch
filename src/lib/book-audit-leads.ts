import type { BookAuditPayload } from "@/lib/validation/book-audit";
import { isDurableMissedCallStoreConfigured } from "@/lib/config";
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
 * is enabled. Uses atomic INSERT … ON CONFLICT so concurrent duplicates do not
 * race into a 503. Returns null when Postgres is not configured.
 */
export async function persistBookAuditLead(
  input: PersistBookAuditLeadInput,
): Promise<PersistedBookAuditLead | null> {
  if (!isDurableMissedCallStoreConfigured()) return null;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;

  const pool = getPgPool(url);
  const id = `bal_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const inserted = await pool.query<{
    id: string;
    email_sent: boolean;
    crm_forwarded: boolean;
  }>(
    `INSERT INTO mc_book_audit_leads (
         id, idempotency_key, email, phone, company, preferred_language,
         service_consent, marketing_consent, consent_wording, consent_source,
         consent_at, payload, email_sent, crm_forwarded, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13,$14,
         $15::timestamptz,$15::timestamptz
       )
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, email_sent, crm_forwarded`,
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
      duplicate: false,
      emailSent: inserted.rows[0].email_sent,
      crmForwarded: inserted.rows[0].crm_forwarded,
    };
  }

  const existing = await pool.query<{
    id: string;
    email_sent: boolean;
    crm_forwarded: boolean;
  }>(
    `SELECT id, email_sent, crm_forwarded
     FROM mc_book_audit_leads
     WHERE idempotency_key = $1
     LIMIT 1`,
    [input.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error("book-audit idempotency conflict without existing row");
  }
  return {
    id: row.id,
    duplicate: true,
    emailSent: row.email_sent,
    crmForwarded: row.crm_forwarded,
  };
}

/** Update per-channel delivery flags after email/CRM attempts (OR-merge). */
export async function updateBookAuditDelivery(
  id: string,
  flags: { emailSent: boolean; crmForwarded: boolean },
): Promise<void> {
  if (!isDurableMissedCallStoreConfigured()) return;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;

  const pool = getPgPool(url);
  await pool.query(
    `UPDATE mc_book_audit_leads
     SET email_sent = email_sent OR $2,
         crm_forwarded = crm_forwarded OR $3,
         updated_at = now()
     WHERE id = $1`,
    [id, flags.emailSent, flags.crmForwarded],
  );
}

/**
 * Atomically claim the right to attempt undelivered channels for a lead.
 * Returns null when another worker already claimed (or both channels done).
 */
export async function claimBookAuditDelivery(
  id: string,
): Promise<{ emailSent: boolean; crmForwarded: boolean } | null> {
  if (!isDurableMissedCallStoreConfigured()) return null;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;

  const pool = getPgPool(url);
  const claimed = await pool.query<{
    email_sent: boolean;
    crm_forwarded: boolean;
  }>(
    `UPDATE mc_book_audit_leads
     SET payload = payload || jsonb_build_object(
           'delivery_claim', '1',
           'delivery_claim_at', to_jsonb(now()::text)
         ),
         updated_at = now()
     WHERE id = $1
       AND (email_sent = false OR crm_forwarded = false)
       AND COALESCE(payload->>'delivery_claim', '') <> '1'
     RETURNING email_sent, crm_forwarded`,
    [id],
  );
  if (!claimed.rows[0]) return null;
  return {
    emailSent: claimed.rows[0].email_sent,
    crmForwarded: claimed.rows[0].crm_forwarded,
  };
}

/** Clear a delivery claim so a later retry can repair partial failures. */
export async function releaseBookAuditDeliveryClaim(id: string): Promise<void> {
  if (!isDurableMissedCallStoreConfigured()) return;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  const pool = getPgPool(url);
  await pool.query(
    `UPDATE mc_book_audit_leads
     SET payload = payload - 'delivery_claim' - 'delivery_claim_at',
         updated_at = now()
     WHERE id = $1
       AND (email_sent = false OR crm_forwarded = false)`,
    [id],
  );
}
