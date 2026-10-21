import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createMemoryGmailStore } from "../../src/product/gmail/store";
import { createPostgresGmailStore } from "../../src/product/gmail/postgres-store";
import { createMemoryNotificationStore } from "../../src/product/notifications/store";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import {
  createNotificationService,
  type NoticeMember,
} from "../../src/product/notifications/service";
import { defaultPreferences } from "../../src/product/notifications/templates";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import { createHarness, at } from "../support/gmail-harness";
import type { GmailMessage } from "../../src/product/gmail/types";
import { gmailReplyEvent } from "../../src/product/gmail/notifications";
import type { NotificationStore } from "../../src/product/notifications/store";

const owner = { organizationId: "org_a", userId: "usr_a" };
function serviceFor(store: NotificationStore) {
  let now = at(5);
  let failure = false;
  const emails: { to: string; message: string }[] = [];
  const texts: { to: string; body: string }[] = [];
  const members: NoticeMember[] = [
    {
      userId: "other",
      role: "owner",
      email: "other@example.test",
      locale: "en",
    },
    {
      userId: owner.userId,
      role: "member",
      email: "owner@example.test",
      locale: "fr",
    },
  ];
  const service = createNotificationService({
    store,
    now: () => now,
    loadOrg: async (id) => ({
      id,
      name: "Staging",
      status: "active",
      timezone: "America/Toronto",
      localeDefault: "en",
      accountType: "production",
      phoneE164: "+15145550111",
    }),
    listMembers: async () => members,
    sendEmail: async (input) => {
      emails.push(input);
      return { sent: !failure, temporary: true };
    },
    sendSms: async (input) => {
      texts.push(input);
      return { sent: true };
    },
  });
  const preferences = async (
    channels = { inApp: true, email: true, sms: true },
  ) => {
    const p = defaultPreferences(
      owner.organizationId,
      owner.userId,
      "fr",
      now.toISOString(),
    );
    p.categories.replies = channels;
    p.quietEnabled = false;
    p.scope = "assigned";
    await store.savePreferences(p);
    return p;
  };
  return {
    service,
    emails,
    texts,
    members,
    preferences,
    setFailure: (v: boolean) => (failure = v),
    setNow: (v: Date) => (now = v),
  };
}
function message(): GmailMessage {
  return {
    id: "gml_a",
    ...owner,
    accountId: "gac_a",
    gmailId: "gmail_1",
    threadId: "thread_1",
    fromName: "Private Sender",
    fromEmail: "sender@example.test",
    subject: "Confidential subject",
    snippet: "private",
    bodyText: "secret body",
    receivedAt: at(1).toISOString(),
    unread: true,
    important: true,
    hasAttachments: false,
    attachments: [],
    direction: "inbound",
    createdAt: at(1).toISOString(),
  };
}
describe("important Gmail reply alerts", () => {
  it("honors email/SMS preferences for the mailbox owner only and hides mail contents externally", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    await h.preferences();
    await store.insertOutbox(gmailReplyEvent(message()));
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0].to, "owner@example.test");
    assert.match(h.emails[0].message, /courriel client/);
    assert.doesNotMatch(
      h.emails[0].message,
      /Confidential|Private Sender|secret body/,
    );
    assert.equal(h.texts.length, 1);
    assert.doesNotMatch(
      h.texts[0].body,
      /Confidential|Private Sender|secret body/,
    );
    assert.equal(
      (await h.service.listForUser(owner.organizationId, "other")).length,
      0,
    );
    const notes = await h.service.listForUser(
      owner.organizationId,
      owner.userId,
    );
    assert.equal(notes.length, 1);
    assert.match(notes[0].note.message, /Confidential subject/);
    assert.equal(notes[0].note.title, "Nouveau courriel client");
  });
  it("supports external-only alerts when in-app notices are disabled", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    await h.preferences({ inApp: false, email: true, sms: false });
    await store.insertOutbox(gmailReplyEvent(message()));
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 1);
    assert.equal(h.texts.length, 0);
    assert.equal(
      (await h.service.listForUser(owner.organizationId, owner.userId)).length,
      0,
    );
  });
  it("leaves external channels opt-in by default", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    await store.insertOutbox(gmailReplyEvent(message()));
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 0);
    assert.equal(h.texts.length, 0);
    assert.equal(
      (await h.service.listForUser(owner.organizationId, owner.userId)).length,
      1,
    );
  });
  it("queues imports atomically and never alerts for historical/automated/outbound mail", async () => {
    const notes = createMemoryNotificationStore();
    const h = createHarness(createMemoryGmailStore(notes));
    await h.connect("owner@gmail.com");
    const box = h.google.mailbox("owner@gmail.com");
    box.deliver({
      from: "old@example.test",
      subject: "Old",
      text: "old",
      at: at(-60),
    });
    await h.sync(0);
    box.deliver({
      from: "customer@example.test",
      subject: "New",
      text: "new",
      at: at(1),
    });
    box.deliver({
      from: "noreply@example.test",
      subject: "Automated",
      text: "auto",
      at: at(1),
    });
    box.deliver({
      from: "owner@gmail.com",
      subject: "Outbound",
      text: "sent",
      labels: ["SENT"],
      at: at(1),
    });
    await h.sync(2);
    const queued = await notes.claimOutbox(25, at(3).toISOString());
    assert.equal(queued.length, 1);
    assert.equal(queued[0].type, "gmail_reply");
    assert.equal(queued[0].payload.recipientUserId, owner.userId);
  });
  it("keeps a failed import out of the message store if queuing fails", async () => {
    const notes = createMemoryNotificationStore();
    notes.insertOutbox = async () => {
      throw Error("database down");
    };
    const store = createMemoryGmailStore(notes);
    const h = createHarness(store);
    await h.connect("owner@gmail.com");
    const account = await h.account();
    await assert.rejects(
      store.upsertMessage({ ...message(), accountId: account.id }, true),
      /database down/,
    );
    assert.equal(
      (await store.listMessages(owner.organizationId, owner.userId)).length,
      0,
    );
  });
  it("defers during quiet hours and rechecks opt-outs before retrying", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    const p = await h.preferences();
    p.quietEnabled = true;
    p.quietStart = "20:00";
    p.quietEnd = "08:00";
    await store.savePreferences(p);
    h.setNow(new Date("2026-10-19T02:00:00Z"));
    await store.insertOutbox(gmailReplyEvent(message()));
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 0);
    assert.equal(h.texts.length, 0);
    p.categories.replies.email = false;
    p.categories.replies.sms = false;
    await store.savePreferences(p);
    h.setNow(new Date("2026-10-19T13:00:00Z"));
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 0);
    assert.equal(h.texts.length, 0);
    assert.ok(
      (await store.listDeliveries(owner.organizationId))
        .filter((d) => d.channel !== "in_app")
        .every((d) => d.status === "canceled"),
    );
  });
  it("retries provider failures once under concurrent workers, without resetting completed deliveries", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    await h.preferences({ inApp: true, email: true, sms: false });
    h.setFailure(true);
    const event = gmailReplyEvent(message());
    await store.insertOutbox(event);
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 1);
    h.setFailure(false);
    h.setNow(at(7));
    await Promise.all([
      h.service.processDue(25, "gmail_reply"),
      h.service.processDue(25, "gmail_reply"),
    ]);
    assert.equal(h.emails.length, 2);
    event.status = "pending";
    await store.saveOutbox(event);
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 2);
  });
  it("keeps the Gmail scheduler from processing unrelated notifications", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    await h.service.enqueue({
      organizationId: owner.organizationId,
      type: "lead_created",
      idempotencyKey: "unrelated",
    });
    await h.service.processDue(25, "gmail_reply");
    assert.equal(
      (await store.listNotifications(owner.organizationId)).length,
      0,
    );
    assert.equal((await store.claimOutbox(25, at(5).toISOString())).length, 1);
  });
  it("does not deliver retries for a removed mailbox owner", async () => {
    const store = createMemoryNotificationStore();
    const h = serviceFor(store);
    await h.preferences();
    h.setFailure(true);
    await store.insertOutbox(gmailReplyEvent(message()));
    await h.service.processDue(25, "gmail_reply");
    h.members.splice(1, 1);
    h.setNow(at(7));
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 1);
  });
});

const databaseUrl = process.env.GMAIL_ALERTS_TEST_DATABASE_URL;
describe("Gmail outbox in isolated PostgreSQL", { skip: !databaseUrl }, () => {
  let pool: Pool;
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/tc004_staging");
    pool = new Pool({ connectionString: databaseUrl });
    for (const file of [
      "src/product/missed-call/schema.sql",
      "src/product/notifications/schema.sql",
      "src/product/notifications/delivery-reliability.sql",
      "src/product/gmail/schema.sql",
    ])
      await pool.query(readFileSync(file, "utf8"));
  });
  after(async () => {
    await pool?.end();
    await closePgPool();
  });
  afterEach(async () => {
    await pool.query(
      "DROP TRIGGER IF EXISTS tc004_reject_queue ON tc_outbox_events",
    );
  });
  it("persists the message and owner-only outbox together, deduplicates replays, and safely claims concurrent deliveries", async () => {
    const notes = createPostgresNotificationStore(databaseUrl!);
    const mail = createPostgresGmailStore(databaseUrl!);
    const harness = createHarness(mail);
    await harness.connect("owner@gmail.com");
    const account = await harness.account();
    const input = { ...message(), accountId: account.id };
    await mail.upsertMessage(input, true);
    await mail.upsertMessage(input, true);
    assert.equal(
      (await pool.query("SELECT * FROM tc_outbox_events")).rowCount,
      1,
    );
    const h = serviceFor(notes);
    await h.preferences();
    await Promise.all([
      h.service.processDue(25, "gmail_reply"),
      h.service.processDue(25, "gmail_reply"),
    ]);
    assert.equal(h.emails.length, 1);
    assert.equal(h.texts.length, 1);
    await pool.query("UPDATE tc_outbox_events SET status='pending'");
    await h.service.processDue(25, "gmail_reply");
    assert.equal(h.emails.length, 1);
  });
  it("rolls back the message when the durable alert insertion fails", async () => {
    const mail = createPostgresGmailStore(databaseUrl!);
    const harness = createHarness(mail);
    await harness.connect("second@gmail.com", { ...owner, userId: "usr_b" });
    const account = await harness.account({ ...owner, userId: "usr_b" });
    await pool.query(
      "CREATE OR REPLACE FUNCTION tc004_reject_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER tc004_reject_queue BEFORE INSERT ON tc_outbox_events FOR EACH ROW EXECUTE FUNCTION tc004_reject_queue()",
    );
    const input = {
      ...message(),
      id: "gml_rollback",
      gmailId: "rollback",
      accountId: account.id,
      userId: "usr_b",
    };
    await assert.rejects(
      mail.upsertMessage(input, true),
      /test outbox failure/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT * FROM tc_gmail_messages WHERE id='gml_rollback'",
        )
      ).rowCount,
      0,
    );
  });
});
