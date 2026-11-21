/**
 * A consistent incident fingerprint (KAN-28).
 *
 * Two failures that mean the same thing must map to the same string so they
 * land in one incident: it is built only from the service, the operation and
 * the error code, with request ids, UUIDs, call ids and counters folded away.
 * A business identifier is deliberately NOT part of it: a provider outage that
 * hits fifty businesses is one incident that says "50 businesses affected", not
 * fifty alerts.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PROVIDER_ID = /\b(?:CA|SM|AC|PN|RE|evt|req|inc|err)[_-]?[0-9a-z]{8,}\b/gi;
const LONG_NUMBER = /\d{3,}/g;
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi;

function fold(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(UUID, "#")
    .replace(PROVIDER_ID, "#")
    .replace(LONG_HEX, "#")
    .replace(LONG_NUMBER, "#")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.:#-]/g, "")
    .replace(/#+/g, "#")
    .slice(0, 48);
}

export function incidentFingerprint(parts: {
  service: string;
  category?: string;
  operation?: string;
  code?: string;
}): string {
  const pieces = [parts.service, parts.category, parts.operation, parts.code]
    .map(fold)
    .filter(Boolean);
  return (pieces.join(":") || "unknown").slice(0, 160);
}
