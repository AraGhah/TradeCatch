import { redactAuditDetail } from "./permissions";

/**
 * "What changed" for an audit record. Values are summarised, never copied
 * wholesale: contact details are masked and anything that looks like a secret
 * is redacted, so reading the audit log never reveals more than the dashboard
 * already shows an administrator, and never a password, key, token or card.
 */
export type AuditChange = { field: string; from?: string; to?: string };

const MAX_VALUE = 120;
const MAX_CHANGES = 30;

/** Field names whose values are contact details: kept only in masked form. */
const MASKED_FIELD = /(phone|email|mobile)/i;
/** Field names that must never be recorded, even masked. */
const FORBIDDEN_FIELD =
  /(password|secret|token|api[-_]?key|card|cvc|cvv|pan|authorization|cookie)/i;

export function maskContact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    const [local, domain = ""] = trimmed.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

function display(field: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  const safe = MASKED_FIELD.test(field)
    ? maskContact(text)
    : redactAuditDetail(text);
  return safe.slice(0, MAX_VALUE);
}

/**
 * Compares `before` and `after` over `fields` and returns only the fields whose
 * value actually changed. A forbidden field is reported as changed with no
 * values, so the fact is auditable and the value is not.
 */
export function summarizeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): AuditChange[] {
  const out: AuditChange[] = [];
  for (const field of fields) {
    const was = before[field];
    const now = after[field];
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
    if (FORBIDDEN_FIELD.test(field)) {
      out.push({ field });
    } else {
      out.push({
        field,
        from: display(field, was),
        to: display(field, now),
      });
    }
    if (out.length >= MAX_CHANGES) break;
  }
  return out;
}

/** Makes an untrusted value safe to store as the `changes` column. */
export function sanitizeChanges(value: unknown): AuditChange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AuditChange[] = [];
  for (const item of value.slice(0, MAX_CHANGES)) {
    if (!item || typeof item !== "object") continue;
    const { field, from, to } = item as Record<string, unknown>;
    if (typeof field !== "string" || !field) continue;
    const name = field.slice(0, 60);
    if (FORBIDDEN_FIELD.test(name)) {
      out.push({ field: name });
      continue;
    }
    out.push({
      field: name,
      from: display(name, from),
      to: display(name, to),
    });
  }
  return out.length ? out : undefined;
}
