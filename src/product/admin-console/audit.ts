import type { AdminActor } from "@/lib/admin-rbac";
import type { AuditChange } from "@/product/security/audit-changes";
import { recordSecurityEvent } from "@/product/security/hooks";
import type { AuditOutcome } from "@/product/security/store";

/**
 * Records a sensitive administrative action: who (id, email, role), what
 * (action, target, field-level changes) and when (the audit service stamps it).
 *
 * This is in addition to the one-line "admin_request" row the guard writes for
 * every state-changing request. That row proves a request arrived; this one says
 * what it did. Failures to write are logged and swallowed by the hook, exactly
 * like every other audit call, so an audit outage can never take a customer's
 * change down with it.
 */
export async function recordAdminAction(
  actor: AdminActor,
  input: {
    action: string;
    organizationId?: string;
    target?: string;
    detail?: string;
    outcome?: AuditOutcome;
    changes?: AuditChange[];
  },
) {
  await recordSecurityEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email ?? actor.label,
    actorRole: actor.role,
    ...input,
  });
}
