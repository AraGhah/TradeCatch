import { getSecurityService } from "./runtime";

export async function recordSecurityEvent(input: {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  target?: string;
  detail?: string;
}) {
  try {
    await getSecurityService().audit(input);
  } catch (error) {
    console.warn("[security] audit skipped", error instanceof Error ? error.message : "unknown");
  }
}
