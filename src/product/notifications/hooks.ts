import type { NotificationType } from "./types";

/** Best-effort handoff. A failed notification must not undo the business event. */
export async function emitBusinessEvent(input: {
  organizationId: string;
  type: NotificationType;
  idempotencyKey: string;
  customer?: string;
  service?: string;
  location?: string;
  whenLabel?: string;
  leadId?: string;
  appointmentId?: string;
  callId?: string;
  href?: string;
  consolidateKey?: string;
  assigneeUserId?: string;
  simulated?: boolean;
}) {
  try {
    const { getNotificationService } = await import("./runtime");
    await getNotificationService().enqueue({
      organizationId: input.organizationId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input,
    });
    await getNotificationService().processDue(10);
  } catch (error) {
    console.warn("[notifications] event skipped", error instanceof Error ? error.message : "unknown");
  }
}

export async function emitTransferFailed(clientAccountId: string, callId: string) {
  try {
    const { getSaasStore } = await import("@/product/saas/runtime");
    const org = await getSaasStore().findOrganizationByMissedCallClientId(clientAccountId);
    if (!org || org.status !== "active") return;
    await emitBusinessEvent({
      organizationId: org.id,
      type: "transfer_failed",
      idempotencyKey: `transfer:${callId}`,
      callId,
      href: "/app/calls",
    });
  } catch (error) {
    console.warn("[notifications] transfer alert skipped", error instanceof Error ? error.message : "unknown");
  }
}
