import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createNotificationService,
  type NoticeMember,
} from "../../src/product/notifications/service";
import { createMemoryNotificationStore } from "../../src/product/notifications/store";
import type { NotificationStore } from "../../src/product/notifications/store";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import { createNotificationTestSchema } from "../support/notification-pg-schema";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import { quietHours } from "../../src/product/notifications/preferences";
import {
  isInsideSendingWindow,
  nextWindowStart,
} from "../../src/product/sms-automation/window";

function harness(
  timezone = "America/Toronto",
  store: NotificationStore = createMemoryNotificationStore(),
) {
  let now = new Date("2026-10-23T15:00:00Z");
  let fail = false;
  const members: NoticeMember[] = [
    {
      userId: "en",
      role: "owner",
      locale: "en",
      email: "en@example.invalid",
      phoneE164: "+15145550101",
      phoneVerifiedAt: now.toISOString(),
    },
    {
      userId: "fr",
      role: "admin",
      locale: "fr",
      email: "fr@example.invalid",
      phoneE164: "+15145550102",
      phoneVerifiedAt: now.toISOString(),
    },
  ];
  const email: { to: string; subject: string; message: string }[] = [];
  const sms: { to: string; body: string }[] = [];
  const deps = {
    store,
    now: () => now,
    listMembers: async (id: string) => (id === "org" ? members : []),
    loadOrg: async (id: string) =>
      id === "org"
        ? {
            id,
            name: "Trade Test",
            status: "active",
            timezone,
            localeDefault: "en" as const,
            phoneE164: "+15145550999",
            accountType: "live",
          }
        : null,
    sendEmail: async (input: (typeof email)[number]) => {
      email.push(input);
      return { sent: !fail };
    },
    sendSms: async (input: (typeof sms)[number]) => {
      sms.push(input);
      return { sent: !fail };
    },
  };
  return {
    service: createNotificationService(deps),
    restart: () => createNotificationService(deps),
    store,
    email,
    sms,
    members,
    setNow: (value: string) => {
      now = new Date(value);
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe("TC-028 quiet hours", () => {
  it("validates real 24-hour times and rejects ambiguous equal enabled times", () => {
    for (const value of ["", "24:00", "12:60", "8:00", "08:00:00", "noon"]) {
      assert.equal(
        quietHours.safeParse({
          quietEnabled: true,
          quietStart: value,
          quietEnd: "08:00",
        }).success,
        false,
      );
    }
    assert.equal(
      quietHours.safeParse({
        quietEnabled: true,
        quietStart: "08:00",
        quietEnd: "08:00",
      }).success,
      false,
    );
    assert.equal(
      quietHours.safeParse({
        quietEnabled: false,
        quietStart: "08:00",
        quietEnd: "08:00",
      }).success,
      true,
    );
  });
  it("honors minutes, an overnight sending window, and exact minute boundaries", () => {
    const config = {
      windowStartHour: 8,
      startMinute: 37,
      windowEndHour: 20,
      endMinute: 12,
      weekendSending: true,
    };
    assert.equal(
      isInsideSendingWindow(
        new Date("2026-10-23T12:36:59Z"),
        "America/Toronto",
        config,
      ),
      false,
    );
    assert.equal(
      nextWindowStart(
        new Date("2026-10-23T12:36:59Z"),
        "America/Toronto",
        config,
      ).toISOString(),
      "2026-10-23T12:37:00.000Z",
    );
    assert.equal(
      isInsideSendingWindow(
        new Date("2026-10-24T00:12:00Z"),
        "America/Toronto",
        config,
      ),
      false,
    );
    const overnight = {
      ...config,
      windowStartHour: 17,
      startMinute: 30,
      windowEndHour: 13,
      endMinute: 15,
    };
    assert.equal(
      isInsideSendingWindow(
        new Date("2026-10-24T03:00:00Z"),
        "America/Toronto",
        overnight,
      ),
      true,
    );
    assert.equal(
      isInsideSendingWindow(
        new Date("2026-10-23T19:00:00Z"),
        "America/Toronto",
        overnight,
      ),
      false,
    );
  });
  it("computes the next local morning across spring and fall DST changes", () => {
    const config = {
      windowStartHour: 8,
      startMinute: 37,
      windowEndHour: 20,
      weekendSending: true,
    };
    assert.equal(
      nextWindowStart(
        new Date("2026-03-08T06:55:00Z"),
        "America/Toronto",
        config,
      ).toISOString(),
      "2026-03-08T12:37:00.000Z",
    );
    assert.equal(
      nextWindowStart(
        new Date("2026-11-01T05:55:00Z"),
        "America/Toronto",
        config,
      ).toISOString(),
      "2026-11-01T13:37:00.000Z",
    );
  });
  it("uses the business timezone and bypasses quiet hours when disabled", async () => {
    for (const enabled of [true, false]) {
      const h = harness("America/Vancouver");
      h.setNow("2026-10-23T15:15:00Z"); // 08:15 Vancouver, 11:15 Toronto.
      for (const m of h.members) {
        const prefs = await h.service.getPreferences("org", m.userId, m.locale);
        await h.service.savePreferences({
          ...prefs,
          quietEnd: "08:37",
          quietEnabled: enabled,
        });
      }
      await h.service.enqueue({
        organizationId: "org",
        type: "lead_created",
        idempotencyKey: "zone",
      });
      await h.service.processDue();
      assert.equal(h.email.length, enabled ? 0 : 2);
      if (enabled) {
        assert.equal(
          (await h.service.history("org"))[0].nextAttemptAt,
          "2026-10-23T15:37:00.000Z",
        );
        h.setNow("2026-10-23T15:37:00Z");
        await h.service.processDue();
        assert.equal(h.email.length, 2);
      }
    }
  });
  it("rechecks quiet hours on retries without spending provider attempts", async () => {
    const h = harness();
    h.fail(true);
    await h.service.enqueue({
      organizationId: "org",
      type: "lead_created",
      idempotencyKey: "retry",
    });
    await h.service.processDue();
    for (const m of h.members) {
      const prefs = await h.service.getPreferences("org", m.userId, m.locale);
      await h.service.savePreferences({
        ...prefs,
        quietStart: "10:00",
        quietEnd: "12:37",
      });
    }
    h.setNow("2026-10-23T15:05:00Z");
    await h.service.processDue();
    assert.equal(h.email.length, 2);
    assert.ok(
      (await h.service.history("org"))
        .filter((d) => d.channel === "email")
        .every(
          (d) =>
            d.attempts === 1 && d.nextAttemptAt === "2026-10-23T16:37:00.000Z",
        ),
    );
  });
});

describe("TC-029 recipient language", () => {
  it("renders email, SMS, subjects and app content separately without exposing template inputs", async () => {
    const h = harness();
    await h.service.saveEscalation({
      ...(await h.service.getEscalation("org")),
      primaryUserId: "en",
      secondaryUserId: "fr",
    });
    // Saved preference takes precedence over the profile locale.
    const prefs = await h.service.getPreferences("org", "en", "en");
    await h.service.savePreferences({ ...prefs, language: "fr" });
    const other = await h.service.getPreferences("org", "fr", "fr");
    await h.service.savePreferences({ ...other, language: "en" });
    await h.service.enqueue({
      organizationId: "org",
      type: "urgent_request",
      idempotencyKey: "languages",
      payload: { customer: "Alex", service: "Repair", location: "Laval" },
    });
    await h.service.processDue();
    assert.match(
      h.email.find((e) => e.to.startsWith("en@"))!.subject,
      /Demande urgente/,
    );
    assert.match(
      h.email.find((e) => e.to.startsWith("fr@"))!.subject,
      /Urgent customer/,
    );
    assert.match(
      h.sms.find((s) => s.to.endsWith("101"))!.body,
      /demande urgente/,
    );
    assert.match(
      h.sms.find((s) => s.to.endsWith("102"))!.body,
      /urgent request/,
    );
    for (const [id, title] of [
      ["en", "Demande urgente"],
      ["fr", "Urgent customer request"],
    ]) {
      const [row] = await h.service.listForUser("org", id);
      assert.equal(row.note.title, title);
      assert.equal(row.note.content, undefined);
      const detail = await h.service.getForUser("org", id, row.note.id);
      assert.equal(detail.notification.content, undefined);
    }
    assert.deepEqual(await h.service.listForUser("other-org", "en"), []);
  });
  it("uses the current recipient language after restart and retry", async () => {
    const h = harness();
    h.fail(true);
    await h.service.enqueue({
      organizationId: "org",
      type: "lead_created",
      idempotencyKey: "retry-language",
      payload: { customer: "Alex", location: "Laval" },
    });
    await h.service.processDue();
    const prefs = await h.service.getPreferences("org", "en", "en");
    await h.service.savePreferences({ ...prefs, language: "fr" });
    h.setNow("2026-10-23T15:05:00Z");
    h.fail(false);
    await h.restart().processDue();
    assert.match(
      h.email.filter((e) => e.to === "en@example.invalid")[1].subject,
      /Nouveau prospect/,
    );
    assert.match(h.email.at(-1)!.message, /Laval/);
  });
  it("renders grouped events in the reader's language", async () => {
    const h = harness();
    await h.service.enqueue({
      organizationId: "org",
      type: "lead_created",
      idempotencyKey: "group-1",
      payload: { customer: "Alex", consolidateKey: "call" },
    });
    await h.service.enqueue({
      organizationId: "org",
      type: "appointment_confirmed",
      idempotencyKey: "group-2",
      payload: { customer: "Alex", consolidateKey: "call", whenLabel: "10:00" },
    });
    await h.service.processDue();
    assert.match(
      (await h.service.listForUser("org", "fr"))[0].note.message,
      /10:00/,
    );
    assert.match(
      (await h.service.listForUser("org", "fr"))[0].note.title,
      /Nouveau prospect/,
    );
  });
  it("localizes the backup contact when escalation creates a later delivery", async () => {
    const h = harness();
    h.members[1].role = "member";
    await h.service.saveEscalation({
      ...(await h.service.getEscalation("org")),
      primaryUserId: "en",
      secondaryUserId: "fr",
      delayMinutes: 1,
    });
    await h.service.enqueue({
      organizationId: "org",
      type: "urgent_request",
      idempotencyKey: "backup",
      payload: { customer: "Alex", service: "Repair" },
    });
    await h.service.processDue();
    assert.equal(h.sms.length, 1);
    h.setNow("2026-10-23T15:02:00Z");
    await h.service.processEscalations();
    await h.service.processDue();
    assert.match(h.sms[1].body, /demande urgente/);
  });
});

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe("TC-029 persisted localization", { skip: !databaseUrl }, () => {
  it("retains template inputs after PostgreSQL reload without returning them to the recipient", async () => {
    const schema = await createNotificationTestSchema(databaseUrl!);
    try {
      const h = harness(
        "America/Toronto",
        createPostgresNotificationStore(schema.connectionString),
      );
      h.fail(true);
      await h.service.enqueue({
        organizationId: "org",
        type: "lead_created",
        idempotencyKey: "durable-language",
        payload: { customer: "Alex", location: "Laval" },
      });
      await h.service.processDue();
      const [stored] = await h.store.listNotifications("org");
      assert.equal(stored.content?.[0].payload.customer, "Alex");
      const prefs = await h.service.getPreferences("org", "en", "en");
      await h.service.savePreferences({ ...prefs, language: "fr" });
      h.fail(false);
      h.setNow("2026-10-23T15:05:00Z");
      await h.restart().processDue();
      assert.match(
        h.email.filter((e) => e.to === "en@example.invalid")[1].subject,
        /Nouveau prospect/,
      );
      const [row] = await h.restart().listForUser("org", "en");
      assert.match(row.note.message, /Alex.*Laval/);
      assert.equal(row.note.content, undefined);
    } finally {
      await closePgPool();
      await schema.drop();
    }
  });
});
