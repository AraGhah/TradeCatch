import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { createNotificationService } from "../../src/product/notifications/service";
import {
  createMemoryNotificationStore,
  type NotificationStore,
} from "../../src/product/notifications/store";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import { createNotificationTestSchema } from "../support/notification-pg-schema";
import { closePgPool } from "../../src/product/missed-call/postgres-store";

function harness(store: NotificationStore, sms = false) {
  const org = randomUUID();
  let now = new Date("2026-10-24T16:00:00Z");
  let sequence = 0;
  const service = createNotificationService({
    store,
    now: () => now,
    loadOrg: async (id) =>
      id === org
        ? {
            id,
            name: "Fixture",
            status: "active",
            timezone: "UTC",
            localeDefault: "en",
            accountType: "production",
          }
        : null,
    listMembers: async (id) =>
      id === org
        ? [
            {
              userId: "owner",
              role: "owner",
              email: "owner@example.invalid",
              locale: "en",
            },
            {
              userId: "backup",
              phoneE164: sms ? "+15145550123" : undefined,
              phoneVerifiedAt: sms ? "2026-01-01T00:00:00Z" : undefined,
              role: "admin",
              email: "backup@example.invalid",
              locale: "en",
            },
          ]
        : [],
    sendEmail: async () => ({ sent: true }),
    sendSms: async () => ({ sent: true, sid: `SM${org}${++sequence}` }),
  });
  return {
    service,
    store,
    org,
    advance: () => {
      now = new Date(now.getTime() + 60_000);
    },
  };
}

function cases(factory: () => NotificationStore) {
  it("reports queued and provider-submitted separately, then confirms or fails on SMS callbacks", async () => {
    const h = harness(factory(), true);
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.org)),
      secondaryUserId: "backup",
      delayMinutes: 1,
      maxAttempts: 2,
    });
    await h.service.enqueue({
      organizationId: h.org,
      type: "urgent_request",
      idempotencyKey: "status",
    });
    await h.service.processDue();
    const [note] = await h.service.listForUser(h.org, "backup");
    h.advance();
    await h.service.processEscalations();
    const outcomes = async () =>
      (
        await h.service.getForUser(h.org, "backup", note.note.id)
      ).escalation.map((row) => row.outcome);
    assert.deepEqual(await outcomes(), ["backup_queued"]);
    await h.service.processDue();
    assert.deepEqual(await outcomes(), ["backup_submitted"]);
    const [delivery] = (await h.store.listDeliveries(h.org)).filter((row) =>
      row.idempotencyKey.includes(":escalation:"),
    );
    await h.service.applyProviderStatus(delivery.providerSid!, "delivered");
    await h.service.applyProviderStatus(
      delivery.providerSid!,
      "failed",
      "30007",
    );
    assert.deepEqual(await outcomes(), ["backup_notified"]);
    h.advance();
    await h.service.processEscalations();
    await h.service.processDue();
    const second = (await h.store.listDeliveries(h.org)).find((row) =>
      row.idempotencyKey.endsWith(":escalation:2"),
    )!;
    await h.service.applyProviderStatus(second.providerSid!, "failed", "30007");
    assert.deepEqual(await outcomes(), ["backup_notified", "backup_failed"]);
    // Historical queue-time claims must not duplicate or override provider state.
    await h.store.addEscalationAttempt({
      organizationId: h.org,
      notificationId: note.note.id,
      outcome: "backup_notified",
      at: new Date().toISOString(),
    });
    assert.deepEqual(await outcomes(), ["backup_notified", "backup_failed"]);
  });

  it("never promotes accepted email to confirmed delivery", async () => {
    const h = harness(factory());
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.org)),
      secondaryUserId: "backup",
      delayMinutes: 1,
    });
    await h.service.enqueue({
      organizationId: h.org,
      type: "urgent_request",
      idempotencyKey: "email-status",
    });
    await h.service.processDue();
    h.advance();
    await h.service.processEscalations();
    await h.service.processDue();
    const [note] = await h.service.listForUser(h.org, "backup");
    assert.deepEqual(
      (
        await h.service.getForUser(h.org, "backup", note.note.id)
      ).escalation.map((row) => row.outcome),
      ["backup_submitted"],
    );
  });

  it("escalates to an existing recipient without resetting read state; spaces and bounds retries", async () => {
    const h = harness(factory());
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.org)),
      secondaryUserId: "backup",
      delayMinutes: 1,
      maxAttempts: 2,
    });
    await h.service.enqueue({
      organizationId: h.org,
      type: "urgent_request",
      idempotencyKey: "urgent",
    });
    await h.service.processDue();
    const [initial] = await h.service.listForUser(h.org, "backup");
    assert.ok(initial, "backup already received initial alert");
    await h.service.markRead(h.org, "backup", initial.note.id);
    const read = (await h.service.getForUser(h.org, "backup", initial.note.id))
      .recipient.readAt;
    h.advance();
    const results = await Promise.all([
      h.service.processEscalations(),
      h.service.processEscalations(),
    ]);
    assert.equal(
      results.reduce((sum, r) => sum + r.escalated, 0),
      1,
    );
    assert.equal(
      (await h.service.getForUser(h.org, "backup", initial.note.id)).recipient
        .readAt,
      read,
    );
    assert.equal((await h.service.processEscalations()).escalated, 0);
    h.advance();
    assert.equal((await h.service.processEscalations()).escalated, 1);
    h.advance();
    assert.equal((await h.service.processEscalations()).escalated, 0);
    const rows = (await h.store.listDeliveries(h.org)).filter((r) =>
      r.idempotencyKey.includes(":escalation:"),
    );
    assert.equal(rows.length, 2);
    assert.equal(
      (await h.store.listRecipients(h.org, initial.note.id)).length,
      2,
    );
  });

  it("does not escalate an acknowledged alert", async () => {
    const h = harness(factory());
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.org)),
      secondaryUserId: "backup",
      delayMinutes: 1,
    });
    await h.service.enqueue({
      organizationId: h.org,
      type: "urgent_request",
      idempotencyKey: "ack",
    });
    await h.service.processDue();
    const [row] = await h.service.listForUser(h.org, "owner");
    await h.service.acknowledge(h.org, "owner", row.note.id);
    h.advance();
    assert.equal((await h.service.processEscalations()).escalated, 0);
  });
}

describe("backup escalation in memory", () =>
  cases(createMemoryNotificationStore));
describe(
  "backup escalation in PostgreSQL",
  { skip: !process.env.NOTIFICATION_TEST_DATABASE_URL },
  () => {
    let schema: Awaited<ReturnType<typeof createNotificationTestSchema>>;
    before(async () => {
      schema = await createNotificationTestSchema(
        process.env.NOTIFICATION_TEST_DATABASE_URL!,
      );
    });
    after(async () => {
      await closePgPool();
      await schema?.drop();
    });
    cases(() => createPostgresNotificationStore(schema.connectionString));
  },
);
