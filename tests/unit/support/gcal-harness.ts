import {
  clientCredentials,
  requestTokens,
  type GoogleUrls,
} from "../../../src/product/scheduling/gcal/client";
import { createOpenGoogle } from "../../../src/product/scheduling/gcal/open";
import {
  detachedCalendarPort,
  googlePortFor,
} from "../../../src/product/scheduling/gcal/port";
import { createGoogleSync } from "../../../src/product/scheduling/gcal/sync";
import { sealTokens } from "../../../src/product/scheduling/google";
import {
  createSchedulingService,
  createSimulatedCalendar,
} from "../../../src/product/scheduling/service";
import {
  createMemorySchedulingStore,
  type SchedulingStore,
} from "../../../src/product/scheduling/store";
import { FakeGoogleCalendar } from "../../support/fake-google-calendar";

export const URLS: GoogleUrls = {
  auth: "http://fake.google/o/oauth2/v2/auth",
  token: "http://fake.google/token",
  revoke: "http://fake.google/revoke",
  api: "http://fake.google/calendar/v3",
};

export const OWNER = "owner@example.test";

/** Sets what the Google modules read from the environment. Call the result in `after`. */
export function useGoogleEnv(): () => void {
  const keys = ["AUTH_SECRET", "GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.AUTH_SECRET = "test-auth-secret-for-calendar-sync-0123456789";
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id.test";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

export type HarnessOptions = {
  /** Businesses whose plan allows Google Calendar. */
  allowed?: string[];
  /** The test clock's start. Monday 2026-10-19 is the first bookable weekday. */
  start?: string;
  store?: SchedulingStore;
  webhookUrl?: string | undefined;
};

/**
 * A fake Google, the real sync engine, the real scheduling service and a clock
 * the test controls, wired exactly as the runtime wires them.
 */
export function createHarness(options: HarnessOptions = {}) {
  const google = new FakeGoogleCalendar();
  const store = options.store ?? createMemorySchedulingStore();
  let nowMs = Date.parse(options.start ?? "2026-10-16T12:00:00Z");
  google.now = () => nowMs;
  const now = () => new Date(nowMs);
  const advance = (ms: number) => {
    nowMs += ms;
  };
  const allowed = new Set(options.allowed ?? ["org_a"]);
  const isAllowed = async (organizationId: string) => allowed.has(organizationId);
  const revokedNotices: string[] = [];

  const open = createOpenGoogle({
    store,
    allowed: isAllowed,
    configured: () => true,
    fetchImpl: google.fetch,
    urls: URLS,
    now,
  });
  const sync = createGoogleSync({
    store,
    open,
    allowed: isAllowed,
    async rules(organizationId) {
      const rules = await store.getRules(organizationId);
      return rules
        ? { timezone: rules.timezone, maxAdvanceDays: rules.maxAdvanceDays }
        : null;
    },
    now,
    random: () => 0.5,
    webhookUrl: () =>
      "webhookUrl" in options
        ? options.webhookUrl
        : "https://tradecatch.example/api/webhooks/google-calendar",
    async onRevoked(organizationId) {
      revokedNotices.push(organizationId);
    },
    fetchImpl: google.fetch,
    urls: URLS,
  });
  const service = createSchedulingService({
    store,
    now,
    async calendar(organizationId, hint) {
      const rules = await store.getRules(organizationId);
      if (!rules || rules.calendarMode !== "google") {
        return hint?.eventId && !hint.eventId.startsWith("simcal_")
          ? detachedCalendarPort
          : createSimulatedCalendar();
      }
      return googlePortFor({ organizationId, store, sync, open });
    },
    async beforeDisconnect(organizationId) {
      await sync.teardown(organizationId);
    },
    async afterCalendarSelected(organizationId) {
      await sync.start(organizationId);
    },
  });

  /** The owner completes Google's consent screen and picks a calendar. */
  async function connect(
    organizationId = "org_a",
    email = OWNER,
    calendarId = email,
  ) {
    const exchanged = await requestTokens(
      {
        ...clientCredentials(),
        code: google.codeFor(email),
        redirect_uri: "https://tradecatch.example/api/calendar/oauth/callback",
        grant_type: "authorization_code",
      },
      { fetchImpl: google.fetch, urls: URLS, now: () => nowMs },
    );
    if (!exchanged.ok) throw new Error(`token exchange failed: ${exchanged.kind}`);
    await store.saveConnection({
      organizationId,
      provider: "google",
      status: "error",
      lastError: "select_calendar",
      accountEmail: email,
      tokenCiphertext: sealTokens({ ...exchanged.tokens, email }),
      expiresAt: exchanged.tokens.expiresAt,
      scope: exchanged.tokens.scope,
    });
    return service.selectCalendar(organizationId, calendarId, "Work calendar");
  }

  let bookings = 0;
  /** A confirmed booking through the real service (the dashboard path). */
  function book(
    organizationId: string,
    startAt: string,
    extra: Partial<Parameters<typeof service.book>[0]> = {},
  ) {
    bookings += 1;
    return service.book({
      organizationId,
      startAt,
      source: "dashboard",
      customerName: "Alice Tremblay",
      customerPhoneE164: "+15145550101",
      serviceAddress: "12 rue Privée, Montréal",
      idempotencyKey: `test-booking-${bookings}`,
      ...extra,
    });
  }

  /** Writes TradeCatch made to Google (everything but reads). */
  function writes() {
    return google.calls.filter(
      (call) =>
        call.path.startsWith("/calendar/v3/calendars/") &&
        ["POST", "PATCH", "DELETE"].includes(call.method) &&
        !call.path.endsWith("/watch"),
    );
  }

  return {
    google,
    store,
    service,
    sync,
    open,
    now,
    advance,
    allowed,
    revokedNotices,
    connect,
    book,
    writes,
  };
}

export type Harness = ReturnType<typeof createHarness>;

/** Monday 2026-10-19, 10:00 America/Toronto (EDT) = 14:00Z. */
export const MONDAY_10 = "2026-10-19T14:00:00.000Z";
export const MONDAY_10_END = "2026-10-19T15:00:00.000Z";
export const MONDAY_13 = "2026-10-19T17:00:00.000Z";
export const TUESDAY_10 = "2026-10-20T14:00:00.000Z";
