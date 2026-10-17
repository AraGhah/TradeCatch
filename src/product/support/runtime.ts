import { createSupportService } from "./service";
import { createPostgresSupportStore } from "./postgres-store";
import { createMemorySupportStore, type SupportStore } from "./store";

const globalForSupport = globalThis as unknown as { __tradecatchSupport?: SupportStore };

function store(): SupportStore {
  if (!globalForSupport.__tradecatchSupport) {
    const url = process.env.DATABASE_URL?.trim();
    const durable = process.env.MISSED_CALL_DURABLE_STORE === "1" || process.env.SAAS_DURABLE_STORE === "1";
    globalForSupport.__tradecatchSupport = durable && url ? createPostgresSupportStore(url) : createMemorySupportStore();
  }
  return globalForSupport.__tradecatchSupport;
}

export function getSupportService() {
  return createSupportService({
    store: store(),
    now: () => new Date(),
    async notify(input) {
      const { emitBusinessEvent } = await import("@/product/notifications/hooks");
      await emitBusinessEvent({
        organizationId: input.organizationId,
        type: "support_update",
        idempotencyKey: `support:${input.ticketId}:${Date.now()}`,
        href: "/app/support",
        simulated: input.simulated,
      });
    },
  });
}
