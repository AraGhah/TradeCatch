import { createHash } from "node:crypto";

/**
 * The row id a repeated request resolves to, so the store's primary key does
 * the de-duplication (`ON CONFLICT (id) DO NOTHING`) with no extra table.
 *
 * `scope` must name the owner of the row (the organization, the ticket, the
 * conversation): the same key sent by another tenant then names a different
 * row and can never reach theirs.
 */
export function idempotentId(prefix: string, scope: string, key: string) {
  const digest = createHash("sha256")
    .update(`${scope}\u0000${key}`)
    .digest("hex");
  return `${prefix}_${digest.slice(0, 32)}`;
}
