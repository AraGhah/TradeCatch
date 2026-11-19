import type { AuditChange } from "./audit-changes";
import { getSecurityService } from "./runtime";
import type { AuditOutcome } from "./store";

export async function recordSecurityEvent(input: {
  organizationId?: string;
  actorUserId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  target?: string;
  detail?: string;
  outcome?: AuditOutcome;
  changes?: AuditChange[];
}) {
  try {
    await getSecurityService().audit(input);
  } catch (error) {
    console.warn("[security] audit skipped", error instanceof Error ? error.message : "unknown");
  }
}
