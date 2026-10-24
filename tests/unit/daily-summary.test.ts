import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createNotificationTestSchema } from "../support/notification-pg-schema";
import {
  createNotificationService,
  type NoticeMember,
} from "../../src/product/notifications/service";
import {
  createMemoryNotificationStore,
  type NotificationStore,
} from "../../src/product/notifications/store";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import { defaultPreferences } from "../../src/product/notifications/templates";
import {
  localDateKey,
  startOfLocalDay,
  usableTimeZone,
} from "../../src/product/notifications/daily-summary";
import { POST as dailySummaryTick } from "../../src/app/api/notifications/daily-summary/tick/route";
import { resetNotificationRuntimeForTests } from "../../src/product/notifications/runtime";

// 2026-10-21 18:30 in Toronto (EDT, UTC-4).
const EVENING = "2026-10-21T22:30:00Z";
const AFTERNOON = "2026-10-21T21:30:00Z"; // 17:30 Toronto: not due yet
const MORNING = "2026-10-21T13:00:00Z"; // 09:00 Toronto

function harness(
  store: NotificationStore,
  options: { timezone?: string; organizationId?: string } = {},
) {
  const organizationId =
    options.organizationId ?? "summary_fixture_" + randomUUID().slice(0, 8);
  let now = Date.parse(MORNING);
  const members: NoticeMember[] = [
    {
      userId: "owner",
      role: "owner",
      email: "owner@example.test",
      locale: "en",
    },
    {
      userId: "admin_fr",
      role: "admin",
      email: "admin@example.test",
      locale: "fr",
    },
    {
      userId: "opted_out",
      role: "admin",
      email: "out@example.test",
      locale: "en",
    },
  ];
  const emails: { to: string; subject: string; message: string }[] = [];
  const service = createNotificationService({
    store,
    now: () => new Date(now),
    listMembers: async (id) => (id === organizationId ? members : []),
    loadOrg: async (id) =>
      id === organizationId
        ? {
            id,
            name: "Plomberie Nord",
            status: "active",
            timezone: options.timezone ?? "America/Toronto",
            localeDefault: "en",
            phoneE164: "+15005550006",
            accountType: "production",
          }
        : null,
    sendEmail: async (input) => {
      emails.push(input);
      return { sent: true };
    },
    sendSms: async () => ({ sent: true, sid: "SM" + randomUUID() }),
  });
  const at = (iso: string) => {
    now = Date.parse(iso);
  };
  async function optIn(userId: string, language: "en" | "fr") {
    const prefs = defaultPreferences(
      organizationId,
      userId,
      language,
      new Date(now).toISOString(),
    );
    prefs.dailySummary = true;
    await service.savePreferences(prefs);
  }
  async function optOut(userId: string) {
    const prefs = defaultPreferences(
      organizationId,
      userId,
      "en",
      new Date(now).toISOString(),
    );
    await service.savePreferences(prefs);
  }
  async function event(
    type: Parameters<typeof service.enqueue>[0]["type"],
    key: string,
  ) {
    await service.enqueue({
      organizationId,
      type,
      idempotencyKey: key,
      payload: { customer: "Private Customer Name", service: "Drain repair" },
    });
    for (let i = 0; i < 4; i++) await service.processDue(25);
  }
  async function summariesFor(userId: string) {
    return (await service.listForUser(organizationId, userId)).filter(
      (row) => row.note.type === "daily_summary",
    );
  }
  async function drain() {
    for (let i = 0; i < 6; i++) await service.processDue(25);
  }
  return {
    service,
    store,
    organizationId,
    members,
    emails,
    at,
    optIn,
    optOut,
    event,
    summariesFor,
    drain,
  };
}

function summaryChecks(factory: () => NotificationStore) {
  let h: ReturnType<typeof harness>;
  beforeEach(async () => {
    h = harness(factory());
    await h.optIn("owner", "en");
    await h.optIn("admin_fr", "fr");
    await h.optOut("opted_out");
    h.at(MORNING);
    await h.event("lead_created", "lead-1");
    await h.event("lead_created", "lead-2");
    await h.event("urgent_request", "urgent-1");
    await h.event("appointment_confirmed", "appt-1");
  });

  it("waits for the summary hour in the business's own time zone", async () => {
    h.at(AFTERNOON);
    assert.deepEqual(await h.service.generateDailySummaries(), {
      queued: 0,
      duplicates: 0,
    });
    h.at(EVENING);
    assert.equal((await h.service.generateDailySummaries()).queued, 2);
  });

  it("uses each user's persisted timezone for the same business", async () => {
    const prefs = await h.service.getPreferences(
      h.organizationId,
      "admin_fr",
      "fr",
    );
    await h.service.savePreferences({
      ...prefs,
      timezone: "America/Vancouver",
    });
    assert.equal(
      (await h.store.getPreferences(h.organizationId, "admin_fr"))?.timezone,
      "America/Vancouver",
    );
    h.at(EVENING);
    assert.equal((await h.service.generateDailySummaries()).queued, 1);
    await h.drain();
    assert.equal((await h.summariesFor("owner")).length, 1);
    assert.equal((await h.summariesFor("admin_fr")).length, 0);
    h.at("2026-10-22T01:30:00Z"); // 18:30 Vancouver, 21:30 Toronto
    assert.equal((await h.service.generateDailySummaries()).queued, 1);
    await h.drain();
    assert.equal((await h.summariesFor("admin_fr")).length, 1);
    assert.ok(
      h.emails.some(
        (mail) =>
          mail.to === "admin@example.test" &&
          mail.subject === "Résumé quotidien",
      ),
    );
    assert.equal((await h.service.generateDailySummaries()).queued, 0);
  });
  it("counts activity inside the recipient's own local day", async () => {
    const prefs = await h.service.getPreferences(
      h.organizationId,
      "admin_fr",
      "fr",
    );
    await h.service.savePreferences({
      ...prefs,
      timezone: "America/Vancouver",
    });
    h.at("2026-10-21T05:30:00Z"); // Today Toronto, yesterday Vancouver
    await h.event("lead_created", "early-lead");
    h.at("2026-10-22T01:30:00Z");
    await h.service.generateDailySummaries();
    await h.drain();
    assert.match(
      (await h.summariesFor("admin_fr"))[0].note.message,
      /2 nouveaux prospects/,
    );
    assert.match(
      (await h.summariesFor("owner"))[0].note.message,
      /3 new leads/,
    );
  });
  it("rejects invalid timezone settings and allows the business default", async () => {
    const prefs = await h.service.getPreferences(
      h.organizationId,
      "owner",
      "en",
    );
    await assert.rejects(
      h.service.savePreferences({ ...prefs, timezone: "Invalid/Zone" }),
      /timezone/,
    );
    await h.service.savePreferences({ ...prefs, timezone: "" });
    assert.equal(
      (await h.store.getPreferences(h.organizationId, "owner"))?.timezone,
      undefined,
    );
  });
  it("honors summary opt-out after the daily job queues it", async () => {
    h.at(EVENING);
    await h.service.generateDailySummaries();
    await h.optOut("owner");
    await h.drain();
    assert.equal((await h.summariesFor("owner")).length, 0);
    assert.equal(
      h.emails.filter(
        (m) => m.to === "owner@example.test" && m.subject === "Daily summary",
      ).length,
      0,
    );
  });
  it("writes each opted-in member one summary in their language, from the day's counts", async () => {
    h.at(EVENING);
    await h.service.generateDailySummaries();
    await h.drain();

    const [english] = await h.summariesFor("owner");
    assert.equal(english.note.title, "Daily summary");
    assert.equal(
      english.note.message,
      "Today at Plomberie Nord: 1 urgent request, 2 new leads, 1 appointment confirmed.",
    );
    assert.equal(english.note.href, "/app/notifications");

    const [french] = await h.summariesFor("admin_fr");
    assert.equal(french.note.title, "Résumé quotidien");
    assert.equal(
      french.note.message,
      "Aujourd’hui chez Plomberie Nord : 1 demande urgente, 2 nouveaux prospects, 1 rendez-vous confirmé.",
    );

    assert.equal((await h.summariesFor("opted_out")).length, 0);
    const bodies = h.emails.filter(
      (mail) =>
        mail.subject === "Daily summary" || mail.subject === "Résumé quotidien",
    );
    assert.deepEqual(bodies.map((mail) => mail.to).sort(), [
      "admin@example.test",
      "owner@example.test",
    ]);
    for (const mail of bodies)
      assert.doesNotMatch(
        mail.message,
        /Private Customer Name|Drain repair/,
        "an external summary carries counts, never customer details",
      );
  });

  it("creates exactly one summary however often or concurrently the job runs", async () => {
    h.at(EVENING);
    const runs = await Promise.all([
      h.service.generateDailySummaries(),
      h.service.generateDailySummaries(),
      h.service.generateDailySummaries(),
    ]);
    assert.equal(
      runs.reduce((sum, run) => sum + run.queued, 0),
      2,
    );
    await h.drain();
    await h.service.generateDailySummaries();
    h.at("2026-10-21T23:45:00Z");
    await h.service.generateDailySummaries();
    await h.drain();
    assert.equal((await h.summariesFor("owner")).length, 1);
    assert.equal((await h.summariesFor("admin_fr")).length, 1);
    assert.equal(
      h.emails.filter((mail) => /summary|Résumé/i.test(mail.subject)).length,
      2,
    );
  });

  it("covers only the local day, and never counts earlier summaries", async () => {
    h.at(EVENING);
    await h.service.generateDailySummaries();
    await h.drain();

    // Tomorrow has one new lead; today's leads, urgent request and summary do not count.
    h.at("2026-10-22T14:00:00Z");
    await h.event("lead_created", "lead-tomorrow");
    h.at("2026-10-22T22:30:00Z");
    await h.service.generateDailySummaries();
    await h.drain();
    const summaries = await h.summariesFor("owner");
    assert.equal(summaries.length, 2);
    assert.ok(
      summaries.some(
        (row) => row.note.message === "Today at Plomberie Nord: 1 new lead.",
      ),
    );
  });

  it("sends nothing on a quiet day", async () => {
    h.at("2026-10-23T22:30:00Z");
    assert.deepEqual(await h.service.generateDailySummaries(), {
      queued: 0,
      duplicates: 0,
    });
  });

  it("treats stored preferences from before the setting existed as having the default delivery channels", async () => {
    const stored = await h.store.getPreferences(h.organizationId, "owner");
    assert.ok(stored);
    const legacy = structuredClone(stored);
    delete (legacy.categories as Partial<typeof legacy.categories>)
      .daily_summary;
    await h.store.savePreferences(legacy);
    const loaded = await h.service.getPreferences(
      h.organizationId,
      "owner",
      "en",
    );
    assert.deepEqual(loaded.categories.daily_summary, {
      inApp: true,
      email: true,
      sms: false,
    });
    h.at(EVENING);
    await h.service.generateDailySummaries();
    await h.drain();
    assert.equal((await h.summariesFor("owner")).length, 1);
  });
}

describe("daily notification summaries", () => {
  summaryChecks(createMemoryNotificationStore);

  it("uses each business's own time zone", async () => {
    const store = createMemoryNotificationStore();
    const toronto = harness(store);
    const tokyo = harness(store, { timezone: "Asia/Tokyo" });
    for (const h of [toronto, tokyo]) {
      await h.optIn("owner", "en");
      h.at(MORNING);
      await h.event("lead_created", "lead-" + h.organizationId);
      h.at(EVENING);
    }
    // 18:30 in Toronto is 07:30 the next day in Tokyo, so only Toronto is due.
    assert.equal((await toronto.service.generateDailySummaries()).queued, 1);
    assert.equal((await tokyo.service.generateDailySummaries()).queued, 0);
    // 18:30 in Tokyo, after a lead arrived during that Tokyo day.
    tokyo.at("2026-10-21T09:00:00Z");
    await tokyo.event("lead_created", "tokyo-day");
    tokyo.at("2026-10-21T09:30:00Z");
    assert.equal((await tokyo.service.generateDailySummaries()).queued, 1);
  });

  it("falls back to Toronto time when a stored time zone is not valid", () => {
    assert.equal(usableTimeZone("Not/AZone"), "America/Toronto");
    assert.equal(usableTimeZone(undefined), "America/Toronto");
    assert.equal(usableTimeZone("Asia/Tokyo"), "Asia/Tokyo");
  });

  it("finds the start of a local day across daylight-saving changes", () => {
    assert.equal(
      startOfLocalDay(new Date(EVENING), "America/Toronto").toISOString(),
      "2026-10-21T04:00:00.000Z",
    );
    // Clocks go back on 2026-11-01: the day is 25 hours long.
    assert.equal(
      startOfLocalDay(
        new Date("2026-11-01T23:30:00Z"),
        "America/Toronto",
      ).toISOString(),
      "2026-11-01T04:00:00.000Z",
    );
    // Clocks go forward on 2026-03-08: midnight is still standard time.
    assert.equal(
      startOfLocalDay(
        new Date("2026-03-08T23:30:00Z"),
        "America/Toronto",
      ).toISOString(),
      "2026-03-08T05:00:00.000Z",
    );
    assert.equal(
      startOfLocalDay(
        new Date("2026-10-21T13:00:00Z"),
        "Asia/Kolkata",
      ).toISOString(),
      "2026-10-20T18:30:00.000Z",
    );
    assert.equal(
      localDateKey(new Date("2026-10-21T05:30:00Z"), "Pacific/Auckland"),
      "2026-10-21",
    );
    assert.equal(
      localDateKey(new Date("2026-10-21T05:30:00Z"), "America/Toronto"),
      "2026-10-21",
    );
    assert.equal(
      localDateKey(new Date("2026-10-21T03:30:00Z"), "America/Toronto"),
      "2026-10-20",
    );
  });
});

describe("daily summary scheduled endpoint", () => {
  it("rejects callers without the scheduler credential and runs for the scheduler", async () => {
    const names = [
      "NOTIFICATION_RETRY_SECRET",
      "MISSED_CALL_OPS_SECRET",
      "CRON_SECRET",
      "DATABASE_URL",
      "SAAS_DURABLE_STORE",
      "MISSED_CALL_DURABLE_STORE",
    ];
    const saved = new Map(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => delete process.env[name]);
    process.env.NOTIFICATION_RETRY_SECRET = "synthetic-notification-job-secret";
    resetNotificationRuntimeForTests();
    const call = (headers: Record<string, string>) =>
      dailySummaryTick(
        new NextRequest(
          "https://example.test/api/notifications/daily-summary/tick",
          {
            method: "POST",
            headers,
          },
        ),
      );
    try {
      assert.equal((await call({})).status, 401);
      assert.equal(
        (await call({ authorization: "Bearer wrong-secret" })).status,
        401,
      );
      const ok = await call({
        authorization: "Bearer synthetic-notification-job-secret",
        "x-vercel-cron": "cloudflare",
      });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true, queued: 0, duplicates: 0 });
    } finally {
      resetNotificationRuntimeForTests();
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe(
  "daily notification summaries in isolated PostgreSQL",
  { skip: !databaseUrl },
  () => {
    let schema: Awaited<ReturnType<typeof createNotificationTestSchema>>;
    before(async () => {
      schema = await createNotificationTestSchema(databaseUrl!);
    });
    after(async () => {
      await closePgPool();
      await schema?.drop();
    });
    summaryChecks(() =>
      createPostgresNotificationStore(schema.connectionString),
    );
  },
);
