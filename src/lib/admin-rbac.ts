/**
 * Role-based access control for the TradeCatch administration console.
 *
 * Identity (who is an administrator) is decided elsewhere: the operator's
 * TRADECATCH_ADMIN_EMAILS list or a user's platform_role. This module only
 * decides WHAT an administrator may do, and it runs on the server for every
 * admin API request, so hiding a button in the UI is never the control.
 *
 * Roles are assigned in the operator-controlled environment list, never in a
 * form, so an administrator cannot promote themselves:
 *
 *   TRADECATCH_ADMIN_EMAILS="founder@x.ca, helper@x.ca:support, cfo@x.ca:read_only"
 *
 * An entry without a suffix is a super administrator (what every existing
 * entry already meant). An unknown suffix fails CLOSED to read_only.
 *
 * Pure and dependency-free: safe to import from anywhere.
 */

export const ADMIN_ROLES = ["super_admin", "support", "read_only"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  /** View dashboards, lists, health and billing data. */
  "admin.read",
  /** Read the audit log. */
  "audit.read",
  /** Edit a business's information; activate, suspend or deactivate it. */
  "business.write",
  /** Create a customer account. */
  "business.create",
  /** Change a customer's subscription through Stripe. */
  "billing.write",
  /** Review website requests, quote, and record payment status. */
  "website.write",
  /** Every other state-changing admin route (incidents, demos, referrals...). */
  "admin.manage",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const GRANTS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  support: ["admin.read", "audit.read", "business.write", "website.write"],
  read_only: ["admin.read"],
};

export function roleAllows(
  role: AdminRole,
  permission: AdminPermission,
): boolean {
  return GRANTS[role].includes(permission);
}

export function permissionsOf(role: AdminRole): readonly AdminPermission[] {
  return GRANTS[role];
}

/** Higher index = more privileged. */
const RANK: Record<AdminRole, number> = {
  read_only: 0,
  support: 1,
  super_admin: 2,
};

export function highestRole(
  a: AdminRole | null,
  b: AdminRole | null,
): AdminRole | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

const ROLE_ALIASES: Record<string, AdminRole> = {
  super_admin: "super_admin",
  superadmin: "super_admin",
  admin: "super_admin",
  owner: "super_admin",
  support: "support",
  read_only: "read_only",
  readonly: "read_only",
  viewer: "read_only",
};

/** Maps a suffix to a role; anything unrecognised is the least privileged role. */
export function parseAdminRole(raw: string | undefined): AdminRole {
  if (raw === undefined || raw.trim() === "") return "super_admin";
  return ROLE_ALIASES[raw.trim().toLowerCase()] ?? "read_only";
}

/**
 * Splits "email" or "email:role" list entries. The email is returned as the
 * caller wrote it (trimmed): normalisation is the identity layer's job.
 */
export function parseAdminEntries(
  raw: string | undefined,
): { email: string; role: AdminRole }[] {
  if (!raw?.trim()) return [];
  const entries: { email: string; role: AdminRole }[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.lastIndexOf(":");
    const email = colon === -1 ? trimmed : trimmed.slice(0, colon).trim();
    const role = colon === -1 ? undefined : trimmed.slice(colon + 1);
    if (!email) continue;
    entries.push({ email, role: parseAdminRole(role) });
  }
  return entries;
}

/** Who is acting. Used for the audit trail and for permission decisions. */
export type AdminActor = {
  /** Present for a signed-in administrator, absent for the ops secret. */
  userId?: string;
  email?: string;
  /** What an audit reader sees: the email, or "ops:<actor>" for the ops secret. */
  label: string;
  role: AdminRole;
  via: "ops" | "session";
};

export const DEFAULT_READ_PERMISSION: AdminPermission = "admin.read";
export const DEFAULT_WRITE_PERMISSION: AdminPermission = "admin.manage";
