import { NextResponse } from "next/server";
import { authorizeAdminRequest, type AdminAccess } from "@/lib/admin-auth";
import type { AdminPermission } from "@/lib/admin-rbac";
import { isCrossSiteMutation } from "@/lib/csrf";
import { enforcePolicy } from "@/lib/rate-limit-response";

/**
 * Shared plumbing for the administration console's API routes, so every route
 * answers the same way: private, uncached, JSON, and guarded in the same order
 * (cross-site check, administrator + role, then a per-administrator rate limit
 * on changes). The data a route returns is always its own business; this only
 * decides whether the caller may ask.
 */
export const ADMIN_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export function adminReply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: ADMIN_HEADERS });
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export type AdminGuard =
  | { ok: true; access: Extract<AdminAccess, { ok: true }> }
  | { ok: false; response: NextResponse };

export async function guardAdmin(
  request: Request,
  permission: AdminPermission,
): Promise<AdminGuard> {
  const mutation = !SAFE.has(request.method.toUpperCase());
  if (
    mutation &&
    isCrossSiteMutation({
      method: request.method,
      headers: request.headers,
      hosts: [new URL(request.url).host],
    })
  ) {
    return {
      ok: false,
      response: adminReply({ error: "Cross-site request blocked." }, 403),
    };
  }
  const access = await authorizeAdminRequest(request, permission);
  if (!access.ok) {
    return {
      ok: false,
      response: adminReply({ error: access.error }, access.status),
    };
  }
  if (mutation) {
    const limited = await enforcePolicy("admin.console-write", {
      subject: access.actor.userId ?? access.actor.label,
    });
    if (limited) return { ok: false, response: limited };
  }
  return { ok: true, access };
}

/** Reads `?page=` / `?pageSize=` safely. */
export function pageParams(
  params: URLSearchParams,
  defaults: { pageSize?: number; maxPageSize?: number } = {},
) {
  const max = defaults.maxPageSize ?? 100;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(
    max,
    Math.max(
      1,
      Math.floor(Number(params.get("pageSize")) || defaults.pageSize || 25),
    ),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A YYYY-MM-DD query value, or undefined when absent or malformed. */
export function dateParam(value: string | null): string | undefined {
  return value && DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}
