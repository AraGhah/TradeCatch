import {
  adminReply,
  dateParam,
  guardAdmin,
  pageParams,
} from "@/lib/admin-route";
import { getSecurityService } from "@/product/security/runtime";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set(["success", "denied", "failed"]);

/**
 * Searchable audit history: who (administrator id, email, role), what (action,
 * target, a masked before/after summary), when, and the outcome. Read-only by
 * design: the table itself refuses updates and deletes, and there is no write
 * route here. Needs the audit.read permission.
 *
 * Filters: q (free text), action, actor (user id), businessId, outcome, from / to.
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "audit.read");
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const outcome = params.get("outcome") || undefined;
  if (outcome && !OUTCOMES.has(outcome))
    return adminReply({ error: "Unknown outcome." }, 400);
  const { page, pageSize, offset } = pageParams(params);

  try {
    const result = await getSecurityService().searchAudit({
      q: params.get("q")?.slice(0, 100) || undefined,
      action: params.get("action")?.slice(0, 80) || undefined,
      actorUserId: params.get("actor")?.slice(0, 80) || undefined,
      organizationId: params.get("businessId")?.slice(0, 80) || undefined,
      outcome: outcome as "success" | "denied" | "failed" | undefined,
      from: dateParam(params.get("from")),
      to: dateParam(params.get("to")),
      limit: pageSize,
      offset,
    });
    return adminReply({
      ok: true,
      // A row recorded before outcomes existed, or by the in-memory store, is a success.
      rows: result.rows.map((row) => ({
        ...row,
        outcome: row.outcome ?? "success",
      })),
      total: result.total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(result.total / pageSize)),
    });
  } catch (error) {
    console.error("[admin] audit search failed", error);
    return adminReply({ error: "The audit log is unavailable." }, 503);
  }
}
