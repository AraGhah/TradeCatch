import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createNotificationTestSchema } from "../support/notification-pg-schema";
import { createHmac } from "node:crypto";
import {
  getNotificationStore,
  resetNotificationRuntimeForTests,
} from "../../src/product/notifications/runtime";
import { NextRequest } from "next/server";
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
import { POST as callback } from "../../src/app/api/twilio/sms/status/route";
import type { NotificationDelivery } from "../../src/product/notifications/types";

const T0 = Date.parse("2026-10-20T15:00:00Z");
let sequence = 0;
function harness(store: NotificationStore) {
  const organizationId = "notification_fixture_" + ++sequence;
  let now = T0;
  const members: NoticeMember[] = [
    {
      userId: "owner",
      phoneE164: "+15005550007",
      phoneVerifiedAt: new Date(T0).toISOString(),
      role: "owner",
      email: "owner@example.test",
      locale: "en",
    },
    {
      userId: "backup",
      role: "member",
      email: "backup@example.test",
      locale: "fr",
    },
  ];
  const emails: { to: string; message: string }[] = [];
  const texts: { to: string; body: string; sid: string }[] = [];
  const service = createNotificationService({
    store,
    now: () => new Date(now),
    listMembers: async (id) => (id === organizationId ? members : []),
    loadOrg: async (id) =>
      id === organizationId
        ? {
            id,
            name: "Notification staging fixture",
            status: "active",
            timezone: "America/Toronto",
            localeDefault: "en",
            phoneE164: "+15005550006",
            accountType: "production",
          }
        : null,
    sendSms: async (input) => {
      const sid = "SM" + organizationId + "_" + (texts.length + 1);
      texts.push({ ...input, sid });
      return { sent: true, sid };
    },
    sendEmail: async (input) => {
      emails.push(input);
      return { sent: true };
    },
  });
  async function configure() {
    const prefs = defaultPreferences(
      organizationId,
      "owner",
      "en",
      new Date(now).toISOString(),
    );
    prefs.quietEnabled = false;
    prefs.categories.urgent = { inApp: true, email: false, sms: true };
    await service.savePreferences(prefs);
    await service.saveEscalation({
      ...(await service.getEscalation(organizationId)),
      secondaryUserId: "backup",
    });
  }
  async function urgent(key = "urgent") {
    await service.enqueue({
      organizationId,
      type: "urgent_request",
      idempotencyKey: key,
    });
    await service.processDue();
    return (await store.listDeliveries(organizationId)).find(
      (row) => row.channel === "sms",
    )!;
  }
  return {
    service,
    store,
    organizationId,
    emails,
    texts,
    members,
    configure,
    urgent,
    advance: (minutes: number) => {
      now += minutes * 60_000;
    },
    now: () => new Date(now).toISOString(),
  };
}
function recoveryChecks(factory: () => NotificationStore, durable: boolean) {
  let h: ReturnType<typeof harness>;
  beforeEach(async () => {
    h = harness(factory());
    await h.configure();
  });
  it("deduplicates simultaneous stable delivery IDs without resetting sent work", async () => {
    const original = await h.urgent();
    const row: NotificationDelivery = {
      ...original,
      id: original.id + ":concurrent_backup",
      idempotencyKey: original.id + ":concurrent_backup",
      channel: "email",
      destination: "backup@example.test",
      providerSid: undefined,
      status: "pending",
      attempts: 0,
    };
    const inserted = await Promise.all(
      Array.from({ length: 20 }, () => h.store.saveDelivery({ ...row }, true)),
    );
    assert.equal(inserted.filter(Boolean).length, 1);
    await h.store.saveDelivery({ ...row, status: "delivered", attempts: 1 });
    assert.equal(await h.store.saveDelivery(row, true), null);
    const saved = (await h.store.listDeliveries(h.organizationId)).find(
      (delivery) => delivery.id === row.id,
    )!;
    assert.equal(saved.status, "delivered");
    assert.equal(saved.attempts, 1);
  });
  it("retries transient failed callbacks at one and five minutes, then emails the backup exactly once", async () => {
    const first = await h.urgent();
    assert.equal(first.attempts, 1);
    assert.equal(h.texts.length, 1);
    await Promise.all([
      h.service.applyProviderStatus(first.providerSid!, "undelivered", "30003"),
      h.service.applyProviderStatus(first.providerSid!, "undelivered", "30003"),
    ]);
    await h.service.processDue();
    assert.equal(h.texts.length, 1);
    h.advance(1);
    await Promise.all([h.service.processDue(), h.service.processDue()]);
    assert.equal(h.texts.length, 2);
    assert.equal(
      await h.service.applyProviderStatus(first.providerSid!, "delivered"),
      false,
      "old SID is no longer current",
    );
    const secondSid = h.texts[1].sid;
    await h.service.applyProviderStatus(secondSid, "failed", "30008");
    h.advance(4);
    await h.service.processDue();
    assert.equal(h.texts.length, 2);
    h.advance(1);
    await h.service.processDue();
    assert.equal(h.texts.length, 3);
    const thirdSid = h.texts[2].sid;
    await Promise.all([
      h.service.applyProviderStatus(thirdSid, "undelivered", "30003"),
      h.service.applyProviderStatus(thirdSid, "undelivered", "30003"),
    ]);
    await h.service.processDue();
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0].to, "backup@example.test");
    const final = (await h.store.listDeliveries(h.organizationId)).find(
      (row) => row.id === first.id,
    )!;
    assert.equal(final.status, "dead");
    assert.equal(final.attempts, 3);
    assert.ok(final.recoveryHandledAt);
    h.advance(30);
    await h.service.applyProviderStatus(thirdSid, "sent");
    await h.service.processDue();
    assert.equal(h.texts.length, 3);
    assert.equal(h.emails.length, 1);
    assert.equal(
      (await h.service.listAlerts()).filter(
        (row) => row.correlationId === first.id,
      ).length,
      1,
    );
  });
  for (const code of ["21610", "30004", "30005", "30006", "30007"]) {
    it("does not retry permanent SMS failure " + code, async () => {
      const first = await h.urgent();
      await h.service.applyProviderStatus(
        first.providerSid!,
        "undelivered",
        code,
      );
      h.advance(60);
      await h.service.processDue();
      assert.equal(h.texts.length, 1);
      assert.equal(h.emails.length, 1);
      assert.equal(
        (await h.store.findDeliveryBySid(first.providerSid!))?.status,
        "failed",
      );
    });
  }
  it("does not regress delivery success when older statuses or unknown statuses arrive", async () => {
    const first = await h.urgent();
    for (const status of ["queued", "sending", "sent", "unexpected"]) {
      await h.service.applyProviderStatus(first.providerSid!, status);
      assert.equal(
        (await h.store.findDeliveryBySid(first.providerSid!))?.status,
        "submitted",
      );
    }
    await h.service.applyProviderStatus(first.providerSid!, "delivered");
    await h.service.applyProviderStatus(first.providerSid!, "failed", "30003");
    await h.service.applyProviderStatus(first.providerSid!, "sent");
    h.advance(60);
    await h.service.processDue();
    assert.equal(
      (await h.store.findDeliveryBySid(first.providerSid!))?.status,
      "delivered",
    );
    assert.equal(h.texts.length, 1);
    assert.equal(h.emails.length, 0);
  });
  it("recovers after a crash following fallback queue insertion without re-sending the email", async () => {
    const first = await h.urgent();
    const original = h.store.markSmsRecovered;
    let crash = true;
    h.store.markSmsRecovered = async (...args) => {
      if (crash) {
        crash = false;
        throw new Error("synthetic worker crash");
      }
      return original(...args);
    };
    await assert.rejects(
      h.service.applyProviderStatus(first.providerSid!, "failed", "21610"),
      /synthetic worker crash/,
    );
    // Simulate a second worker sending the queued fallback before recovery bookkeeping retries.
    const backup = (await h.store.listDeliveries(h.organizationId)).find(
      (row) => row.id.endsWith(":backup_email"),
    )!;
    backup.status = "submitted";
    backup.attempts = 1;
    await h.store.saveDelivery(backup);
    await h.service.applyProviderStatus(first.providerSid!, "failed", "21610");
    await h.service.processDue();
    const backups = (await h.store.listDeliveries(h.organizationId)).filter(
      (row) => row.id.endsWith(":backup_email"),
    );
    assert.equal(backups.length, 1);
    assert.equal(backups[0].status, "submitted");
    assert.equal(h.emails.length, 0);
  });
  it("honors disabled recovery and does not send a queued fallback to a removed member", async () => {
    h.members[1].phoneE164 = "+15145550128";
    h.members[1].phoneVerifiedAt = h.now();
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.organizationId)),
      emailEnabled: false,
    });
    const first = await h.urgent();
    await h.service.applyProviderStatus(first.providerSid!, "failed", "21610");
    await h.service.processDue();
    assert.equal(h.emails.length, 0);
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.organizationId)),
      emailEnabled: true,
    });
    await h.service.enqueue({
      organizationId: h.organizationId,
      type: "urgent_request",
      idempotencyKey: "another",
    });
    await h.service.processDue();
    await h.service.applyProviderStatus(h.texts[1].sid, "failed", "21610");
    h.members.splice(1, 1);
    await h.service.processDue();
    assert.equal(h.emails.length, 0);
  });
  it("does not queue fallback email when the recipient disabled that category", async () => {
    const prefs = await h.service.getPreferences(
      h.organizationId,
      "backup",
      "fr",
    );
    prefs.categories.urgent.email = false;
    await h.service.savePreferences(prefs);
    const first = await h.urgent();
    await h.service.applyProviderStatus(first.providerSid!, "failed", "21610");
    await h.service.processDue();
    assert.equal(h.emails.length, 0);
    assert.ok(
      !(await h.store.listDeliveries(h.organizationId)).some((r) =>
        r.id.endsWith(":backup_email"),
      ),
    );
    assert.equal(
      (await h.service.listAlerts()).filter((r) => r.correlationId === first.id)
        .length,
      1,
    );
  });
  for (const revoke of [
    "preference",
    "rule",
    "recipient",
    "cleared recipient",
  ]) {
    it(`cancels queued fallback after ${revoke} permission changes`, async () => {
      const first = await h.urgent();
      await h.service.applyProviderStatus(
        first.providerSid!,
        "failed",
        "21610",
      );
      if (revoke === "preference") {
        const prefs = await h.service.getPreferences(
          h.organizationId,
          "backup",
          "fr",
        );
        prefs.categories.urgent.email = false;
        await h.service.savePreferences(prefs);
      } else {
        await h.service.saveEscalation({
          ...(await h.service.getEscalation(h.organizationId)),
          ...(revoke === "rule"
            ? { enabled: false }
            : {
                secondaryUserId: revoke === "recipient" ? "owner" : undefined,
              }),
        });
      }
      await h.service.processDue();
      assert.equal(h.emails.length, 0);
      assert.equal(
        (await h.store.listDeliveries(h.organizationId)).find((r) =>
          r.id.endsWith(":backup_email"),
        )?.status,
        "canceled",
      );
    });
  }
  it("persists overflow, prioritizes critical alerts, and shares a 40-attempt quota across concurrent workers", async () => {
    for (let i = 0; i < 46; i++)
      await h.service.enqueue({
        organizationId: h.organizationId,
        type: "lead_created",
        idempotencyKey: "overflow_" + i,
      });
    for (let i = 0; i < 10; i++)
      await Promise.all([h.service.processDue(), h.service.processDue()]);
    assert.equal(h.emails.length, 40);
    const before = await h.store.listDeliveries(h.organizationId);
    assert.equal(
      before.filter((row) => row.channel === "email").length,
      46,
      "no messages discarded",
    );
    assert.equal(
      before.filter(
        (row) => row.channel === "email" && row.status === "pending",
      ).length,
      6,
    );
    await h.service.enqueue({
      organizationId: h.organizationId,
      type: "urgent_request",
      idempotencyKey: "priority",
    });
    await h.service.processDue();
    assert.equal(
      h.texts.length,
      1,
      "the critical SMS uses the reserve instead of waiting for the window",
    );
    assert.equal(h.emails.length, 40, "normal messages still wait");
    h.advance(10);
    const claims = await h.store.claimDeliveries(h.now());
    assert.equal(
      claims.filter((row) => row.channel === "email").length,
      6,
      "queued messages claim newly available capacity",
    );
    assert.equal(new Set(claims.map((row) => row.id)).size, claims.length);
    if (durable) {
      const fresh = factory();
      assert.equal(
        (await fresh.listDeliveries(h.organizationId)).length,
        94,
        "delivery queue survives store recreation",
      );
    }
  });
  it("reserves the last available slot for a new critical alert ahead of older normal messages", async () => {
    for (let i = 0; i < 39; i++)
      await h.service.enqueue({
        organizationId: h.organizationId,
        type: "lead_created",
        idempotencyKey: "used_" + i,
      });
    for (let i = 0; i < 8; i++) await h.service.processDue();
    assert.equal(h.emails.length, 39);
    for (let i = 0; i < 10; i++)
      await h.service.enqueue({
        organizationId: h.organizationId,
        type: "lead_created",
        idempotencyKey: "waiting_" + i,
      });
    await h.service.enqueue({
      organizationId: h.organizationId,
      type: "urgent_request",
      idempotencyKey: "last_slot_critical",
    });
    for (let i = 0; i < 4; i++) await h.service.processDue();
    assert.equal(h.texts.length, 1);
    assert.equal(h.emails.length, 39);
    h.advance(10);
    for (let i = 0; i < 4; i++) await h.service.processDue();
    assert.equal(
      h.emails.length,
      49,
      "all pending normal alerts eventually drain",
    );
  });
  it("limits both event fan-out and delivery claims to the requested batch size", async () => {
    for (let i = 0; i < 4; i++)
      await h.service.enqueue({
        organizationId: h.organizationId,
        type: "lead_created",
        idempotencyKey: "batch_" + i,
      });
    await h.service.processDue(2);
    assert.equal((await h.store.listNotifications(h.organizationId)).length, 2);
    const deliveries = await h.store.listDeliveries(h.organizationId);
    assert.equal(
      deliveries.filter((row) => row.status !== "pending").length,
      2,
    );
    for (let i = 0; i < 8; i++) await h.service.processDue(2);
    assert.equal(h.emails.length, 4);
  });
  it("keeps an opted-in daily summary preference", async () => {
    const prefs = await h.service.getPreferences(
      h.organizationId,
      "owner",
      "en",
    );
    assert.equal(prefs.dailySummary, false, "summaries are opt-in");
    prefs.dailySummary = true;
    assert.equal((await h.service.savePreferences(prefs)).dailySummary, true);
    assert.equal(
      (await h.service.getPreferences(h.organizationId, "owner", "en"))
        .dailySummary,
      true,
    );
  });
  it("keeps Gmail-only processing from recovering unrelated SMS failures", async () => {
    const first = await h.urgent();
    first.status = "dead";
    await h.store.saveDelivery(first);
    await h.service.processDue(25, "gmail_reply");
    assert.equal(
      (await h.store.listDeliveries(h.organizationId)).some((row) =>
        row.id.endsWith(":backup_email"),
      ),
      false,
    );
    await h.service.processDue();
    assert.equal(h.emails.length, 1);
  });
  it("counts an abandoned provider attempt toward the retry ceiling", async () => {
    const note = await h.urgent();
    const row: NotificationDelivery = {
      ...note,
      status: "pending",
      providerSid: undefined,
      attempts: 2,
    };
    await h.store.saveDelivery(row);
    const claimed = await h.store.claimDeliveries(h.now());
    claimed[0].attempts += 1;
    await h.store.saveDelivery(claimed[0]);
    assert.equal(claimed[0].attempts, 3);
    h.advance(11);
    assert.equal((await h.store.claimDeliveries(h.now())).length, 0);
    const final = (await h.store.listDeliveries(h.organizationId)).find(
      (d) => d.id === note.id,
    )!;
    assert.equal(final.status, "dead");
  });
}
describe("notification delivery recovery with fake providers", () =>
  recoveryChecks(createMemoryNotificationStore, false));

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe(
  "notification queue and recovery in isolated PostgreSQL",
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
    recoveryChecks(
      () => createPostgresNotificationStore(schema.connectionString),
      true,
    );
  },
);

describe("Twilio callback authentication", () => {
  it("rejects a forged callback before attempting notification recovery", async () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TRADECATCH_ENV: process.env.TRADECATCH_ENV,
    };
    Object.assign(process.env, {
      NODE_ENV: "production",
      TRADECATCH_ENV: "production",
      TWILIO_AUTH_TOKEN: "synthetic-signing-secret",
    });
    try {
      const response = await callback(
        new NextRequest("https://example.test/api/twilio/sms/status", {
          method: "POST",
          body: new URLSearchParams({
            MessageSid: "SM_fixture",
            MessageStatus: "failed",
            ErrorCode: "30003",
          }),
          headers: { "x-twilio-signature": "forged" },
        }),
      );
      assert.equal(response.status, 403);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("Twilio callback durable failure", () => {
  it("returns 500 for a signed callback when the notification update fails", async () => {
    const names = [
      "NODE_ENV",
      "TWILIO_AUTH_TOKEN",
      "TRADECATCH_ENV",
      "NEXT_PUBLIC_SITE_URL",
      "TRADECATCH_E2E",
      "DATABASE_URL",
      "SAAS_DURABLE_STORE",
      "MISSED_CALL_DURABLE_STORE",
      "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
      "MISSED_CALL_SKIP_TWILIO_VALIDATE",
    ];
    const saved = new Map(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => delete process.env[name]);
    const url = "http://localhost:3000/api/twilio/sms/status";
    const secret = "synthetic-callback-signing-secret";
    Object.assign(process.env, {
      NODE_ENV: "production",
      TRADECATCH_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      TRADECATCH_E2E: "1",
      TWILIO_AUTH_TOKEN: secret,
    });
    resetNotificationRuntimeForTests();
    const params: Record<string, string> = {
      MessageSid: "SM_synthetic_callback",
      MessageStatus: "undelivered",
      ErrorCode: "30003",
    };
    const signature = createHmac("sha1", secret)
      .update(
        url +
          Object.keys(params)
            .sort()
            .map((key) => key + params[key])
            .join(""),
      )
      .digest("base64");
    try {
      let notificationUpdateAttempted = false;
      getNotificationStore().applySmsStatus = async () => {
        notificationUpdateAttempted = true;
        throw Error("synthetic durable write failure");
      };
      const response = await callback(
        new NextRequest(url, {
          method: "POST",
          body: new URLSearchParams(params),
          headers: { "x-twilio-signature": signature },
        }),
      );
      assert.equal(response.status, 500);
      assert.equal(notificationUpdateAttempted, true);
    } finally {
      resetNotificationRuntimeForTests();
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
