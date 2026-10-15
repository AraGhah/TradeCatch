import { normalizeEmail } from "./store";
import type { User } from "./types";

/**
 * TradeCatch platform admin = user whose email is in TRADECATCH_ADMIN_EMAILS
 * or who has platform_role=admin on tc_users.
 */
type EnvLike = Record<string, string | undefined>;

export function parseAdminEmails(env: EnvLike = process.env): Set<string> {
  const raw = env.TRADECATCH_ADMIN_EMAILS?.trim() || "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((part) => normalizeEmail(part))
      .filter(Boolean),
  );
}

export function isPlatformAdminUser(
  user: Pick<User, "email" | "platformRole">,
  env: EnvLike = process.env,
): boolean {
  if (user.platformRole === "admin") return true;
  return parseAdminEmails(env).has(normalizeEmail(user.email));
}
