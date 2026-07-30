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

/** Drop one-time tokens and honeypot fields from durable JSON evidence. */
function sanitizeStoredPayload(payload: BookAuditPayload): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...payload };
  delete stored.turnstileToken;
  delete stored.companyWebsite;
  return stored;
}

/**
 * Persist a book-audit lead with consent wording/timestamp when durable store
 * is enabled. Returns null when Postgres is not configured (lead may still be
 * emailed / forwarded to CRM).
 */
export async function persistBookAuditLead(
  input: PersistBookAuditLeadInput,
): Promise<{ id: string; duplicate: boolean } | null> {
  if (!isDurableMissedCallStoreConfigured()) return null;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;

  const pool = getPgPool(url);
  const id = `bal_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM mc_book_audit_leads WHERE idempotency_key = $1 LIMIT 1`,
    [input.idempotencyKey],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, duplicate: true };
  }

  await pool.query(
    `INSERT INTO mc_book_audit_leads (
         id, idempotency_key, email, phone, company, preferred_language,
         service_consent, marketing_consent, consent_wording, consent_source,
         consent_at, payload, email_sent, crm_forwarded, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13,$14,
         $15::timestamptz,$15::timestamptz
       )`,
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
  return { id, duplicate: false };
}
