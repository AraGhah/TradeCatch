import { z } from "zod";
import { adminReply, guardAdmin } from "@/lib/admin-route";
import { readJsonBody } from "@/lib/request-body";
import { recordAdminAction } from "@/product/admin-console/audit";
import { decideStatusChange } from "@/product/admin/account-actions";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.string().max(20),
  confirm: z.string().max(40),
});

const ID = /^[A-Za-z0-9_-]{4,80}$/;

/**
 * Activate, suspend or deactivate a business. The administrator types the
 * action's confirmation word; an administrator cannot lock out the business
 * they are signed in under. A suspended or deactivated business is refused at
 * its next request (the tenant guard checks status on every call).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdmin(request, "business.write");
  if (!guard.ok) return guard.response;
  const { access } = guard;
  const { id } = await context.params;
  if (!ID.test(id)) return adminReply({ error: "missing" }, 404);

  const read = await readJsonBody(request, 1024);
  if (!read.ok) return adminReply({ error: read.error }, read.status);
  const parsed = schema.safeParse(read.data);
  if (!parsed.success) return adminReply({ error: "status" }, 400);

  const decision = decideStatusChange({
    next: parsed.data.status,
    confirm: parsed.data.confirm,
    // The operations secret has no organization, so it can never be "its own" one.
    sessionOrganizationId: access.ctx?.organization.id ?? "",
    targetOrganizationId: id,
  });
  if (!decision.ok) {
    await recordAdminAction(access.actor, {
      action: "admin_account_status_refused",
      organizationId: id,
      target: id,
      outcome: "failed",
      detail: decision.error,
    });
    return adminReply({ error: decision.error }, 400);
  }

  try {
    const store = getSaasStore();
    const before = await store.getOrganization(id);
    if (!before) return adminReply({ error: "missing" }, 404);
    if (before.status === decision.status)
      return adminReply({ ok: true, status: before.status, unchanged: true });
    const updated = await store.updateOrganization(id, {
      status: decision.status,
    });
    if (!updated) return adminReply({ error: "missing" }, 404);
    clearPlatformSnapshot();
    await recordAdminAction(access.actor, {
      action: "admin_account_status",
      organizationId: id,
      target: id,
      detail: decision.status,
      changes: [{ field: "status", from: before.status, to: updated.status }],
    });
    return adminReply({ ok: true, status: updated.status });
  } catch (error) {
    console.error("[admin] status change failed", error);
    return adminReply({ error: "The status could not be changed." }, 503);
  }
}
