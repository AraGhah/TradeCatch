import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { createNotificationTestSchema } from "../support/notification-pg-schema";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import {
  CRITICAL_DELIVERY_RESERVE as POLICY_RESERVE,
  DELIVERY_RATE_LIMIT as POLICY_LIMIT,
  DELIVERY_WINDOW_MS as POLICY_WINDOW_MS,
} from "../../src/product/notifications/delivery-policy";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import {
  createNotificationService,
  type NoticeMember,
} from "../../src/product/notifications/service";
import {
  createMemoryNotificationStore,
  type NotificationStore,
} from "../../src/product/notifications/store";
import { defaultPreferences } from "../../src/product/notifications/templates";
import type {
  ContractorNotification,
  NotificationDelivery,
  Priority,
} from "../../src/product/notifications/types";

const START = Date.parse("2026-10-21T14:00:00Z");
const MINUTE = 60_000;
// The documented policy as literals, so no expectation below is derived from
// the code under test and a change to the policy has to be made deliberately.
const DELIVERY_RATE_LIMIT = 40;
const CRITICAL_DELIVERY_RESERVE = 10;
const DELIVERY_WINDOW_MS = 10 * MINUTE;
const CEILING = DELIVERY_RATE_LIMIT + CRITICAL_DELIVERY_RESERVE;

describe("notification rate limit policy", () => {
  it("is 40 external dispatches per organization per ten minutes, plus a critical reserve of 10", () => {
    assert.equal(POLICY_LIMIT, DELIVERY_RATE_LIMIT);
    assert.equal(POLICY_RESERVE, CRITICAL_DELIVERY_RESERVE);
    assert.equal(POLICY_WINDOW_MS, DELIVERY_WINDOW_MS);
  });
});

function harness(store: NotificationStore, admins = 0) {
  const organizationId = "rate_" + randomUUID().slice(0, 8);
  let now = START;
  const members: NoticeMember[] = [
    {
      userId: "owner",
      role: "owner",
      email: "owner@example.test",
      locale: "en",
    },
  ];
  for (let i = 1; i <= admins; i++)
    members.push({
      userId: `admin_${i}`,
      role: "admin",
      email: `admin${i}@example.test`,
      locale: "en",
    });
  const emails: { idempotencyKey?: string; to: string }[] = [];
  const texts: { to: string; body: string }[] = [];
  const service = createNotificationService({
    store,
    now: () => new Date(now),
    listMembers: async (id) => (id === organizationId ? members : []),
    loadOrg: async (id) =>
      id === organizationId
        ? {
            id,
            name: "Rate limit fixture",
            status: "active",
            timezone: "America/Toronto",
            localeDefault: "en",
            phoneE164: "+15005550006",
            accountType: "production",
          }
        : null,
    sendEmail: async (input) => {
      emails.push(input);
      return { sent: true };
    },
    sendSms: async (input) => {
      texts.push(input);
      return { sent: true, sid: "SM" + randomUUID() };
    },
  });
  /** Urgent requests reach the owner by SMS only, so each one is one reservation. */
  async function ownerGetsUrgentBySms() {
    const prefs = defaultPreferences(
      organizationId,
      "owner",
      "en",
      new Date(now).toISOString(),
    );
    prefs.categories.urgent = { inApp: true, email: false, sms: true };
    await service.savePreferences(prefs);
  }
  async function enqueue(
    type: "lead_created" | "urgent_request",
    count: number,
  ) {
    const tag = randomUUID().slice(0, 6);
    for (let i = 0; i < count; i++)
      await service.enqueue({
        organizationId,
        type,
        idempotencyKey: `${type}:${tag}:${i}`,
      });
  }
  /** `workers` processors race each other on every round, like overlapping cron and request runs. */
  async function drain(rounds = 12, workers = 1) {
    for (let round = 0; round < rounds; round++)
      await Promise.all(
        Array.from({ length: workers }, () => service.processDue()),
      );
  }
  async function external(channel: "email" | "sms", status?: string) {
    return (await store.listDeliveries(organizationId)).filter(
      (row) => row.channel === channel && (!status || row.status === status),
    );
  }
  return {
    service,
    store,
    organizationId,
    members,
    emails,
    texts,
    ownerGetsUrgentBySms,
    enqueue,
    drain,
    external,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function assertEachSentOnce(sent: { idempotencyKey?: string }[]) {
  const keys = sent.map((item) => item.idempotencyKey);
  assert.ok(keys.every(Boolean), "every send carries its idempotency key");
  assert.equal(new Set(keys).size, keys.length, "no delivery is sent twice");
}

function rateLimitChecks(factory: () => NotificationStore) {
  it("reserves each recipient's delivery, so a fan-out beyond the limit is queued, not sent or lost", async () => {
    const h = harness(factory(), 30);
    const recipients = h.members.length;
    // Two events, each fanned out to every member: far more than one window allows.
    await h.enqueue("lead_created", 2);
    await h.drain();
    assert.equal(h.emails.length, DELIVERY_RATE_LIMIT);
    assertEachSentOnce(h.emails);
    assert.equal(
      (await h.external("email")).length,
      2 * recipients,
      "every recipient's delivery was created and kept",
    );
    assert.equal(
      (await h.external("email", "pending")).length,
      2 * recipients - DELIVERY_RATE_LIMIT,
    );

    h.advance(DELIVERY_WINDOW_MS + MINUTE);
    await h.drain();
    assert.equal(
      h.emails.length,
      2 * recipients,
      "the queue drains once capacity returns",
    );
    assertEachSentOnce(h.emails);
  });

  it("shares one quota between overlapping workers", async () => {
    const h = harness(factory(), 30);
    const total = 3 * h.members.length;
    await h.enqueue("lead_created", 3);
    await h.drain(6, 8);
    assert.equal(
      h.emails.length,
      DELIVERY_RATE_LIMIT,
      "eight workers, one quota",
    );
    assertEachSentOnce(h.emails);

    h.advance(DELIVERY_WINDOW_MS + MINUTE);
    await h.drain(6, 8);
    assert.equal(h.emails.length, 2 * DELIVERY_RATE_LIMIT);
    h.advance(DELIVERY_WINDOW_MS + MINUTE);
    await h.drain(6, 8);
    assert.equal(h.emails.length, total, "nothing is lost across windows");
    assertEachSentOnce(h.emails);
  });

  it("lets critical alerts use a reserve when ordinary messages have filled the window", async () => {
    const h = harness(factory());
    await h.ownerGetsUrgentBySms();
    await h.enqueue("lead_created", DELIVERY_RATE_LIMIT);
    await h.drain();
    assert.equal(h.emails.length, DELIVERY_RATE_LIMIT);

    await h.enqueue("lead_created", 1);
    await h.enqueue("urgent_request", CRITICAL_DELIVERY_RESERVE + 2);
    await h.drain();
    assert.equal(
      h.texts.length,
      CRITICAL_DELIVERY_RESERVE,
      "critical alerts are sent at once, up to the reserve",
    );
    assert.equal(
      h.emails.length,
      DELIVERY_RATE_LIMIT,
      "ordinary messages cannot touch the reserve",
    );
    assert.equal(
      (await h.external("sms", "pending")).length,
      2,
      "the overflow is queued",
    );
    assert.equal((await h.external("email", "pending")).length, 1);

    h.advance(DELIVERY_WINDOW_MS + MINUTE);
    await h.drain();
    assert.equal(
      h.texts.length,
      CRITICAL_DELIVERY_RESERVE + 2,
      "no critical alert is lost",
    );
    assert.equal(h.emails.length, DELIVERY_RATE_LIMIT + 1);
  });

  it("serves critical alerts first inside a burst without letting the window exceed its base limit", async () => {
    const h = harness(factory());
    await h.ownerGetsUrgentBySms();
    await h.enqueue("lead_created", DELIVERY_RATE_LIMIT + 5);
    await h.enqueue("urgent_request", 8);
    await h.drain();
    assert.equal(h.texts.length, 8, "every critical alert goes out");
    assert.equal(
      h.emails.length,
      DELIVERY_RATE_LIMIT - 8,
      "ordinary messages take only what is left of the base limit",
    );

    // A late critical alert still gets through immediately.
    await h.enqueue("urgent_request", 1);
    await h.drain();
    assert.equal(h.texts.length, 9);
    assert.equal(h.emails.length, DELIVERY_RATE_LIMIT - 8);

    h.advance(DELIVERY_WINDOW_MS + MINUTE);
    await h.drain();
    assert.equal(
      h.emails.length,
      DELIVERY_RATE_LIMIT + 5,
      "the rest of the burst follows",
    );
  });

  it("reserves atomically when many claims hit the same saturated queue at the same instant", async () => {
    const store = factory();
    const organizationId = "rate_race_" + randomUUID().slice(0, 6);
    await seed(store, organizationId, 120, "normal");
    const at = new Date(START).toISOString();
    // Each caller would see an empty window if reservations were not serialized.
    const batches = await Promise.all(
      Array.from({ length: 12 }, () => store.claimDeliveries(at)),
    );
    const claimed = batches.flat();
    assert.equal(claimed.length, DELIVERY_RATE_LIMIT);
    assert.equal(
      new Set(claimed.map((row) => row.id)).size,
      claimed.length,
      "no delivery is claimed by two callers",
    );
  });

  it("keeps organizations from using each other's quota", async () => {
    const store = factory();
    const busy = "rate_busy_" + randomUUID().slice(0, 6);
    const quiet = "rate_quiet_" + randomUUID().slice(0, 6);
    await seed(store, busy, 70, "normal");
    await seed(store, quiet, 3, "normal");
    const claimed = await claimUntilEmpty(store, START);
    assert.equal(count(claimed, busy), DELIVERY_RATE_LIMIT);
    assert.equal(
      count(claimed, quiet),
      3,
      "a saturated neighbour does not block this business",
    );
  });

  it("never exceeds the window limits however traffic is mixed, and loses nothing", async () => {
    const store = factory();
    const orgA = "rate_a_" + randomUUID().slice(0, 6);
    const orgB = "rate_b_" + randomUUID().slice(0, 6);
    await seed(store, orgA, 100, "normal");
    await seed(store, orgA, 40, "critical", 100);
    await seed(store, orgA, 20, "high", 140);
    await seed(store, orgB, 30, "normal");

    const sent: { organizationId: string; at: number; critical: boolean }[] =
      [];
    const critical = new Set<string>();
    for (const row of await store.listDeliveries(orgA))
      if (row.notificationId.includes("critical")) critical.add(row.id);

    for (let minute = 0; minute <= 90; minute++) {
      const at = START + minute * MINUTE;
      for (const row of await claimUntilEmpty(store, at))
        sent.push({
          organizationId: row.organizationId,
          at,
          critical: critical.has(row.id),
        });
      for (const organizationId of [orgA, orgB]) {
        const inWindow = sent.filter(
          (item) =>
            item.organizationId === organizationId &&
            item.at > at - DELIVERY_WINDOW_MS,
        );
        assert.ok(
          inWindow.length <= CEILING,
          `${organizationId}: ${inWindow.length} dispatches within one window at minute ${minute}`,
        );
        assert.ok(
          inWindow.filter((item) => !item.critical).length <=
            DELIVERY_RATE_LIMIT,
          `${organizationId}: ordinary dispatches exceed the base limit at minute ${minute}`,
        );
      }
    }
    assert.equal(
      count(sent, orgA),
      160,
      "every queued delivery was eventually claimed once",
    );
    assert.equal(count(sent, orgB), 30);
  });
}

/** Writes `count` pending email deliveries (and their notifications) for an organization. */
async function seed(
  store: NotificationStore,
  organizationId: string,
  count: number,
  priority: Priority,
  offset = 0,
) {
  for (let i = 0; i < count; i++) {
    const at = new Date(START - 60 * MINUTE + (offset + i)).toISOString();
    const note: ContractorNotification = {
      id: `${organizationId}_${priority}_${i}`,
      organizationId,
      type: priority === "critical" ? "urgent_request" : "lead_created",
      title: "Seeded",
      message: "Seeded",
      priority,
      idempotencyKey: `seed:${priority}:${i}`,
      simulated: false,
      createdAt: at,
      updatedAt: at,
    };
    await store.saveNotification(note);
    const delivery: NotificationDelivery = {
      id: `${note.id}:email`,
      notificationId: note.id,
      organizationId,
      recipientUserId: "owner",
      channel: "email",
      status: "pending",
      attempts: 0,
      nextAttemptAt: at,
      destination: "owner@example.test",
      simulated: false,
      idempotencyKey: `${note.id}:owner:email`,
      createdAt: at,
      updatedAt: at,
    };
    await store.saveDelivery(delivery);
  }
}

async function claimUntilEmpty(store: NotificationStore, at: number) {
  const all: NotificationDelivery[] = [];
  for (;;) {
    const batch = await store.claimDeliveries(new Date(at).toISOString());
    if (batch.length === 0) return all;
    // A finished send, as the service records it; an unfinished lease would
    // be reclaimed after ten minutes.
    for (const row of batch)
      await store.saveDelivery({ ...row, status: "delivered" });
    all.push(...batch);
  }
}

function count(rows: { organizationId: string }[], organizationId: string) {
  return rows.filter((row) => row.organizationId === organizationId).length;
}

describe("notification rate limiting with fake providers", () =>
  rateLimitChecks(createMemoryNotificationStore));

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe(
  "notification rate limiting in isolated PostgreSQL",
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
    rateLimitChecks(() =>
      createPostgresNotificationStore(schema.connectionString),
    );
  },
);
