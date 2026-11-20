import {
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isProductionRuntime,
} from "@/lib/config";
import { getCrmService } from "@/product/crm/runtime";
import { hasGoogleCalendarPilot } from "./availability";
import { emitBusinessEvent } from "@/product/notifications/hooks";
import { getSaasStore } from "@/product/saas/runtime";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import {
  createCalcomCalendar,
  type CalcomCalendarPort,
} from "./calcom/adapter";
import { getMe } from "./calcom/client";
import {
  calcomMultiCrew,
  calcomPilotAllowed,
  openCalcomKey,
} from "./calcom/connection";
import {
  reconcileCalcom,
  reconcileCalcomOrganization,
} from "./calcom/reconcile";
import { isCalcomEventId } from "./calcom/types";
import { createOpenGoogle, type OpenGoogleFn } from "./gcal/open";
import { detachedCalendarPort, googlePortFor } from "./gcal/port";
import { createGoogleSync, type GoogleSync } from "./gcal/sync";
import { googleCalendarConfigured } from "./google";
import { createPostgresSchedulingStore } from "./postgres-store";
import {
  createSchedulingService,
  createSimulatedCalendar,
  type CalendarPort,
} from "./service";
import { createMemorySchedulingStore, type SchedulingStore } from "./store";

const globalForScheduling = globalThis as unknown as {
  __tradecatchScheduling?: { store: SchedulingStore; durable: boolean };
};

function createStore(): { store: SchedulingStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) {
    return { store: createPostgresSchedulingStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[scheduling] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[scheduling] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
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

/** The address Google pushes change notifications to. Google requires https. */
function googleWebhookUrl(): string | undefined {
  const explicit = process.env.GOOGLE_CALENDAR_WEBHOOK_URL?.trim();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  const url = explicit || (site ? `${site}/api/webhooks/google-calendar` : "");
  if (!url) return undefined;
  return url.startsWith("https://") || isE2eHarness() ? url : undefined;
}

const gcalByStore = new WeakMap<
  SchedulingStore,
  { sync: GoogleSync; open: OpenGoogleFn }
>();

/** The Google synchronization for the current store (built once per store). */
function googleRuntime() {
  const store = getSchedulingStore();
  let built = gcalByStore.get(store);
  if (!built) {
    const open = createOpenGoogle({
      store,
      allowed: hasGoogleCalendarPilot,
      configured: googleCalendarConfigured,
    });
    const sync = createGoogleSync({
      store,
      open,
      allowed: hasGoogleCalendarPilot,
      async rules(organizationId) {
        const rules = await store.getRules(organizationId);
        return rules
          ? { timezone: rules.timezone, maxAdvanceDays: rules.maxAdvanceDays }
          : null;
      },
      webhookUrl: googleWebhookUrl,
      async onRevoked(organizationId) {
        await emitBusinessEvent({
          organizationId,
          type: "calendar_disconnected",
          idempotencyKey: `calendar-disconnected:${organizationId}:${new Date().toISOString().slice(0, 13)}`,
          href: "/app/settings/calendar",
        });
      },
    });
    built = { sync, open };
    gcalByStore.set(store, built);
  }
  return built;
}

export function getGoogleSync(): GoogleSync {
  return googleRuntime().sync;
}

/**
 * A Cal.com business whose connection cannot be used right now. It never
 * confirms anything: availability is empty and every booking is refused, so a
 * caller is taken as a request and nothing is invented.
 */
const disconnectedCalcom: CalendarPort = {
  kind: "calcom",
  connected: false,
  externalCalls: 0,
  async freeBusy() {
    return [];
  },
  async listSlots() {
    return { error: "calendar_unavailable" };
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

/** The working Cal.com provider for a business, or null when it has none. */
export async function calcomPortFor(
  organizationId: string,
): Promise<CalcomCalendarPort | null> {
  const store = getSchedulingStore();
  const connection = await store.getCalcomConnection(organizationId);
  if (!connection || connection.status !== "connected") return null;
  const organization = await getSaasStore().getOrganization(organizationId);
  // The operator's enrollment and the plan are checked on every use, not only
  // when the key was saved: a downgrade or an un-enrolment stops it at once.
  if (!calcomPilotAllowed(organization)) return null;
  const apiKey = openCalcomKey(connection.credentialCiphertext);
  if (!apiKey) return null;
  return createCalcomCalendar({
    organizationId,
    apiKey,
    defaultEventTypeId: connection.defaultEventTypeId,
    routes: connection.routes,
    attendeeEmail: connection.attendeeEmail,
    multiCrew: calcomMultiCrew(organization),
    ledger: {
      get: (org, appointmentId) => store.getCalcomBooking(org, appointmentId),
      findByUid: (org, uid) => store.findCalcomBookingByUid(org, uid),
      save: (row) => store.saveCalcomBooking(row),
    },
  });
}

async function calendarFor(
  organizationId: string,
  hint?: { eventId?: string },
): Promise<CalendarPort> {
  const store = getSchedulingStore();
  const rules = await store.getRules(organizationId);
  // An event made through Cal.com is changed through Cal.com, and one made
  // elsewhere is never sent to Cal.com, whatever the business uses today.
  if (hint?.eventId) {
    if (isCalcomEventId(hint.eventId)) {
      return (await calcomPortFor(organizationId)) ?? disconnectedCalcom;
    }
    if (rules?.calendarMode === "calcom") return detachedCalendarPort;
  } else if (rules?.calendarMode === "calcom") {
    return (await calcomPortFor(organizationId)) ?? disconnectedCalcom;
  }
  if (!rules || rules.calendarMode !== "google") {
    // An event Google once held for this business is no longer managed here.
    if (
      hint?.eventId &&
      !hint.eventId.startsWith("simcal_") &&
      !isCalcomEventId(hint.eventId)
    )
      return detachedCalendarPort;
    return createSimulatedCalendar();
  }
  const { sync, open } = googleRuntime();
  return googlePortFor({ organizationId, store, sync, open });
}

export function getSchedulingService() {
  return createSchedulingService({
    store: getSchedulingStore(),
    now: () => new Date(),
    calendar: calendarFor,
    // The business's own zone seeds its availability rules.
    async businessTimeZone(organizationId) {
      return (await getSaasStore().getOrganization(organizationId))?.timezone;
    },
    async businessTimeZoneChanged(organizationId, timezone) {
      await getSaasStore().updateOrganization(organizationId, { timezone });
    },
    async scheduleNotices(input) {
      await getAutomationServices().scheduleAppointmentNotices(input);
    },
    async cancelNotices(organizationId, appointmentId, reason) {
      await getAutomationServices().cancelAppointmentNotices(
        organizationId,
        appointmentId,
        reason,
      );
    },
    async notify(input) {
      const reason = input.reason.toLowerCase();
      const type = (
        {
          confirmed: "appointment_confirmed",
          requested: "appointment_requested",
          rescheduled: "appointment_rescheduled",
          canceled: "appointment_canceled",
        } as const
      )[input.kind];
      await emitBusinessEvent({
        organizationId: input.organizationId,
        type,
        idempotencyKey: `${type}:${input.refId}:${reason.slice(0, 24)}`,
        customer: input.title,
        service: input.serviceName,
        location: input.serviceAddress,
        whenLabel: input.whenLabel,
        appointmentId: input.refId,
        href: "/app/bookings",
        consolidateKey: input.refId,
      });
    },
    async beforeDisconnect(organizationId) {
      await getGoogleSync().teardown(organizationId);
    },
    async afterCalendarSelected(organizationId) {
      await getGoogleSync().start(organizationId);
    },
    async onDisconnected(organizationId) {
      await emitBusinessEvent({
        organizationId,
        type: "calendar_disconnected",
        idempotencyKey: `calendar-disconnected:${organizationId}:${new Date().toISOString().slice(0, 13)}`,
        href: "/app/settings/calendar",
      });
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

/**
 * The calendars the connected account can write to, for the owner to pick one.
 * Works before a calendar has been chosen. Never returns a token.
 */
export async function listGoogleCalendarsFor(organizationId: string): Promise<
  | { ok: true; calendars: { id: string; summary: string; primary: boolean }[] }
  | { ok: false; reason: "not_connected" | "revoked" | "unavailable"; error: string }
> {
  const opened = await googleRuntime().open(organizationId, { selecting: true });
  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason === "revoked" ? "revoked" : "not_connected",
      error:
        opened.reason === "revoked"
          ? "Google access was removed. Reconnect Google Calendar."
          : "Google Calendar is not connected.",
    };
  }
  const result = await opened.client.listCalendars();
  if (!result.ok) {
    return {
      ok: false,
      reason: result.kind === "auth_revoked" || result.kind === "auth" ? "revoked" : "unavailable",
      error:
        result.kind === "auth_revoked" || result.kind === "auth"
          ? "Google access was removed. Reconnect Google Calendar."
          : "Google Calendar could not be reached. Try again in a moment.",
    };
  }
  return { ok: true, calendars: result.calendars };
}

/** Reads what changed in a business's Google calendar (a notification, the cron, "Sync now"). */
export async function reconcileGoogleBusy(organizationId: string) {
  const outcome = await getGoogleSync().pull(organizationId);
  if (outcome.status === "ok")
    return { synced: true as const, events: outcome.events };
  return {
    synced: false as const,
    reason:
      outcome.status === "failed"
        ? outcome.error
        : outcome.status === "skipped"
          ? outcome.reason
          : "busy",
  };
}

/** The periodic pass: read what changed, renew channels, send what is queued. */
export async function runGoogleSyncTick() {
  return getGoogleSync().tick();
}

function calcomReconcileDeps() {
  const store = getSchedulingStore();
  return {
    store,
    scheduling: getSchedulingService(),
    portFor: calcomPortFor,
    async checkKey(organizationId: string) {
      const connection = await store.getCalcomConnection(organizationId);
      const apiKey = openCalcomKey(connection?.credentialCiphertext);
      if (!apiKey) return "unauthorized" as const;
      const me = await getMe({ apiKey });
      if (me.ok) return "ok" as const;
      return me.kind === "rejected" && me.code === "unauthorized"
        ? ("unauthorized" as const)
        : ("unreachable" as const);
    },
    async onKeyRejected(organizationId: string) {
      await emitBusinessEvent({
        organizationId,
        type: "calendar_disconnected",
        idempotencyKey: `calendar-disconnected:${organizationId}:${new Date().toISOString().slice(0, 13)}`,
        href: "/app/settings/calendar",
      });
    },
  };
}

/** One pass over every business that has Cal.com connected (ops tick). */
export async function reconcileCalcomAll() {
  return reconcileCalcom(calcomReconcileDeps());
}

/** The same pass for one business. */
export async function reconcileCalcomFor(organizationId: string) {
  return reconcileCalcomOrganization(calcomReconcileDeps(), organizationId);
}
