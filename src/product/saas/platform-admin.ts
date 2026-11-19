import {
  highestRole,
  parseAdminEntries,
  type AdminRole,
} from "@/lib/admin-rbac";
import { normalizeEmail } from "./store";
import type { User } from "./types";

/**
 * TradeCatch platform admin = user whose email is in TRADECATCH_ADMIN_EMAILS
 * or who has platform_role=admin on tc_users.
 *
 * An env entry may carry a role suffix ("helper@x.ca:support"); see
 * src/lib/admin-rbac.ts. Identity ("is an administrator") and role ("what they
 * may do") are answered separately so existing checks keep working unchanged.
 */
type EnvLike = Record<string, string | undefined>;

function adminEntries(env: EnvLike) {
  return parseAdminEntries(env.TRADECATCH_ADMIN_EMAILS).map((entry) => ({
    email: normalizeEmail(entry.email),
    role: entry.role,
  }));
}

export function parseAdminEmails(env: EnvLike = process.env): Set<string> {
  return new Set(
    adminEntries(env)
      .map((entry) => entry.email)
      .filter(Boolean),
  );
}

export function isPlatformAdminUser(
  user: Pick<User, "email" | "platformRole">,
  env: EnvLike = process.env,
): boolean {
  return adminRoleOf(user, env) !== null;
}

/**
 * The administrator role of a user, or null when they are not an administrator.
 * `platform_role = admin` in the database is a super administrator. When both
 * sources name the person, the more privileged role wins.
 */
export function adminRoleOf(
  user: Pick<User, "email" | "platformRole">,
  env: EnvLike = process.env,
): AdminRole | null {
  const fromDatabase: AdminRole | null =
    user.platformRole === "admin" ? "super_admin" : null;
  const email = normalizeEmail(user.email);
  const fromEnv =
    adminEntries(env).find((entry) => entry.email === email)?.role ?? null;
  return highestRole(fromDatabase, fromEnv);
}
