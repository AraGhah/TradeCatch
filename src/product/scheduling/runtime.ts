import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { getCrmService } from "@/product/crm/runtime";
import { getGrowthServices } from "@/product/growth";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import {
  createGoogleCalendarPort,
  googleCalendarConfigured,
  openTokens,
  refreshGoogleTokens,
  sealTokens,
} from "./google";
import { createPostgresSchedulingStore } from "./postgres-store";
import { createSchedulingService, createSimulatedCalendar, type CalendarPort } from "./service";
import { createMemorySchedulingStore, type SchedulingStore } from "./store";

const globalForScheduling = globalThis as unknown as {
  __tradecatchScheduling?: { store: SchedulingStore; durable: boolean };
};

function createStore(): { store: SchedulingStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() || process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) {
    return { store: createPostgresSchedulingStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[scheduling] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error("[scheduling] Refusing memory store when SAAS_REQUIRE_DURABLE=1");
  }
  return { store: createMemorySchedulingStore(), durable: false };
}

export function getSchedulingStore(): SchedulingStore {
  if (!globalForScheduling.__tradecatchScheduling) {
    globalForScheduling.__tradecatchScheduling = createStore();
  }
  return globalForScheduling.__tradecatchScheduling.store;
}

export function resetSchedulingRuntimeForTests() {
  delete globalForScheduling.__tradecatchScheduling;
}

const disconnected: CalendarPort = {
  kind: "google",
  connected: false,
  externalCalls: 0,
  async freeBusy() {
    return [];
  },
  async createEvent() {
    return { error: "calendar_unavailable" };
  },
  async updateEvent() {
    return { error: "calendar_unavailable" };
  },
  async deleteEvent() {
    return { error: "calendar_unavailable" };
  },
};

async function calendarFor(organizationId: string): Promise<CalendarPort> {
  const store = getSchedulingStore();
  const rules = await store.getRules(organizationId);
  if (!rules || rules.calendarMode !== "google") return createSimulatedCalendar();
  const connection = await store.getConnection(organizationId);
  if (!connection?.tokenCiphertext || !connection.calendarId || !googleCalendarConfigured()) {
    return disconnected;
  }
  if (connection.status === "expired" || connection.status === "disconnected" || connection.status === "error") {
    return disconnected;
  }
  let tokens = openTokens(connection.tokenCiphertext);
  if (Date.parse(tokens.expiresAt) < Date.now() + 30_000 && tokens.refreshToken) {
    try {
      tokens = await refreshGoogleTokens(tokens);
      connection.tokenCiphertext = sealTokens(tokens);
      connection.expiresAt = tokens.expiresAt;
      connection.status = "connected";
      await store.saveConnection(connection);
    } catch {
      connection.status = "expired";
      connection.lastError = "refresh_failed";
      await store.saveConnection(connection);
      return disconnected;
    }
  }
  return createGoogleCalendarPort({
    tokens,
    calendarId: connection.calendarId,
    onTokens: async (next) => {
      connection.tokenCiphertext = sealTokens(next);
      connection.expiresAt = next.expiresAt;
      await store.saveConnection(connection);
    },
  });
}

export function getSchedulingService() {
  return createSchedulingService({
    store: getSchedulingStore(),
    now: () => new Date(),
    calendar: calendarFor,
    async scheduleNotices(input) {
      await getAutomationServices().scheduleAppointmentNotices(input);
    },
    async cancelNotices(organizationId, appointmentId, reason) {
      await getAutomationServices().cancelAppointmentNotices(organizationId, appointmentId, reason);
    },
    async notify(input) {
      try {
        await getGrowthServices().notifyOwner({
          organizationId: input.organizationId,
          subject: input.reason,
          title: input.title,
          lines: [{ label: "Appointment", value: input.refId }],
        });
      } catch {
        // Notification failure must not undo a confirmed booking.
      }
    },
    async linkLead(input) {
      if (!input.phone) return;
      try {
        const captured = await getCrmService().capture({
          organizationId: input.organizationId,
          phoneE164: input.phone,
          displayName: input.name,
          source: "ai_receptionist",
          now: new Date(),
        });
        return { leadId: captured.lead?.id };
      } catch {
        return;
      }
    },
  });
}

export async function reconcileGoogleBusy(organizationId: string) {
  const service = getSchedulingService();
  const rules = await service.getRules(organizationId);
  if (rules.calendarMode !== "google") return { synced: false as const };
  const port = await calendarFor(organizationId);
  if (!port.connected) {
    const connection = await getSchedulingStore().getConnection(organizationId);
    if (connection && connection.status === "connected") {
      connection.status = "error";
      connection.lastError = "calendar_unavailable";
      await getSchedulingStore().saveConnection(connection);
    }
    return { synced: false as const };
  }
  const from = new Date();
  const until = new Date(from.getTime() + rules.maxAdvanceDays * 24 * 60 * 60 * 1000);
  const blocks = await port.freeBusy(from.toISOString(), until.toISOString());
  await service.syncBusy(organizationId, blocks);
  return { synced: true as const, blocks: blocks.length };
}
