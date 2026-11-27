import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttemptKey } from "../../src/lib/client/attempt-key";
import { createSingleFlight } from "../../src/lib/client/use-single-flight";
import { idempotentId } from "../../src/lib/idempotent-id";
import { queueAnnouncement } from "../../src/product/admin/announcements";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import { createCrmService } from "../../src/product/crm/service";
import { createGrowthServices, createMemoryGrowthStore } from "../../src/product/growth";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { createNotificationService } from "../../src/product/notifications/service";
import { createMemoryNotificationStore } from "../../src/product/notifications/store";
import { createMemoryStarterStore, createStarterServices } from "../../src/product/starter";
import { createSupportService } from "../../src/product/support/service";
import { createMemorySupportStore } from "../../src/product/support/store";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("single flight under a slow response", () => {
  it("keeps dropping calls until the slow one answers, then accepts the next", async () => {
    const flight = createSingleFlight();
    let runs = 0;
    const slow = () =>
      flight.run(async () => {
        runs += 1;
        await sleep(40);
        return "done";
      });
    const first = slow();
    await sleep(10);
    assert.equal(await slow(), undefined, "a click during the wait starts nothing");
    await sleep(10);
    assert.equal(await slow(), undefined);
    assert.equal(await first, "done");
    assert.equal(flight.busy, false);
    assert.equal(await slow(), "done", "the button works again once the answer is in");
    assert.equal(runs, 2);
  });
});

describe("createAttemptKey", () => {
  let n = 0;
  const keys = () => createAttemptKey(() => `key-${++n}`);

  it("reuses the key while the same content is retried", () => {
    const attempt = keys();
    const first = attempt.for('{"subject":"No calls"}');
    assert.equal(attempt.for('{"subject":"No calls"}'), first);
  });

  it("gives edited content a new key, so a retry is never answered with the old row", () => {
    const attempt = keys();
    const first = attempt.for("a");
    assert.notEqual(attempt.for("b"), first);
  });

  it("starts a new submission after the server confirmed", () => {
    const attempt = keys();
    const first = attempt.for("a");
    attempt.done();
    assert.notEqual(attempt.for("a"), first);
  });

  it("uses real random keys by default", () => {
    const a = createAttemptKey().for("x");
    const b = createAttemptKey().for("x");
    assert.match(a, /^[0-9a-f-]{36}$/);
    assert.notEqual(a, b);
  });
});

function supportService() {
  const store = createMemorySupportStore();
  const notices: string[] = [];
  const service = createSupportService({
    store,
    now: () => new Date("2026-11-21T12:00:00.000Z"),
    async notify(input) {
      notices.push(input.ticketId);
    },
  });
  return { store, notices, service };
}

const ticket = {
  organizationId: "org_a",
  subject: "Calls are not forwarded",
  category: "calls" as const,
  description: "Since this morning",
  priority: "high" as const,
  contactEmail: "owner@example.com",
  kind: "feature" as const,
  attachmentNames: ["screenshot.png"],
};

describe("support tickets: one ticket per idempotency key", () => {
  it("answers a repeated request with the first ticket and does nothing twice", async () => {
    const { store, notices, service } = supportService();
    const first = await service.createTicket({ ...ticket, idempotencyKey: "attempt-0001" });
    const again = await service.createTicket({ ...ticket, idempotencyKey: "attempt-0001" });
    assert.equal(again.id, first.id);
    assert.equal((await store.listTickets("org_a")).length, 1);
    assert.equal((await store.listAttachments(first.id)).length, 1);
    assert.deepEqual(notices, [first.id]);
  });

  it("creates one ticket when the same request arrives twice at once", async () => {
    const { store, notices, service } = supportService();
    const [a, b] = await Promise.all([
      service.createTicket({ ...ticket, idempotencyKey: "attempt-0002" }),
      service.createTicket({ ...ticket, idempotencyKey: "attempt-0002" }),
    ]);
    assert.equal(a.id, b.id);
    assert.equal((await store.listTickets("org_a")).length, 1);
    assert.equal(notices.length, 1);
  });

  it("never lets one organization's key reach another organization's ticket", async () => {
    const { service } = supportService();
    const mine = await service.createTicket({ ...ticket, idempotencyKey: "attempt-0003" });
    const theirs = await service.createTicket({
      ...ticket,
      organizationId: "org_b",
      idempotencyKey: "attempt-0003",
    });
    assert.notEqual(theirs.id, mine.id);
    assert.equal(theirs.organizationId, "org_b");
  });

  it("still opens a new ticket for every request without a key", async () => {
    const { store, service } = supportService();
    await service.createTicket(ticket);
    await service.createTicket(ticket);
    assert.equal((await store.listTickets("org_a")).length, 2);
  });

  it("adds a reply once per key, and a new key adds a new reply", async () => {
    const { store, service } = supportService();
    const opened = await service.createTicket(ticket);
    const send = (key: string) =>
      service.reply({
        organizationId: "org_a",
        ticketId: opened.id,
        body: "Any news?",
        authorRole: "contractor",
        idempotencyKey: key,
      });
    const [a, b] = await Promise.all([send("reply-0001"), send("reply-0001")]);
    assert.equal(a.id, b.id);
    assert.equal((await store.listMessages(opened.id)).length, 1);
    await send("reply-0002");
    assert.equal((await store.listMessages(opened.id)).length, 2);
  });
});

describe("website leads: concurrent requests with one key", () => {
  it("sends the opening text once when both requests race", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });
    const lead = () =>
      services.ingestWebsiteLead({
        organizationId: "org_a",
        businessName: "Nord Plumbing",
        phoneE164: "+15145550101",
        name: "Alex",
        idempotencyKey: "form_race",
        smsFromE164: "+15145550999",
        sendOpeningSms: true,
      });
    const [a, b] = await Promise.all([lead(), lead()]);
    assert.equal(a.lead.id, b.lead.id);
    assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true]);
    assert.equal(sms.sent.length, 1);
    assert.equal((await store.listWebsiteLeads("org_a")).length, 1);
  });
});

describe("idempotentId", () => {
  it("names the same row for the same scope and key, and a different row otherwise", () => {
    const id = idempotentId("msg", "org_a:conv_1", "attempt-0001");
    assert.match(id, /^msg_[0-9a-f]{32}$/);
    assert.equal(idempotentId("msg", "org_a:conv_1", "attempt-0001"), id);
    assert.notEqual(idempotentId("msg", "org_b:conv_1", "attempt-0001"), id);
    assert.notEqual(idempotentId("msg", "org_a:conv_1", "attempt-0002"), id);
  });
});

async function crmConversation() {
  const crm = createCrmService(createMemoryCrmStore());
  const captured = await crm.capture({
    organizationId: "org_a",
    source: "manual",
    phoneE164: "+15145550123",
    displayName: "Marie",
  });
  const send = (idempotencyKey?: string, conversationId = captured.conversation.id) =>
    crm.sendHumanMessage({
      organizationId: "org_a",
      conversationId,
      body: "On arrive à 14 h",
      actor: "owner",
      simulated: true,
      idempotencyKey,
    });
  const outbound = async () =>
    (await crm.getConversationBundle("org_a", captured.conversation.id))!.messages.filter(
      (m) => m.direction === "outbound",
    );
  const sentEvents = async () =>
    (await crm.listEvents("org_a", captured.lead.id)).filter((e) => e.kind === "message_out");
  return { crm, captured, send, outbound, sentEvents };
}

describe("lead replies: one message per idempotency key", () => {
  it("answers a repeated send with the first message and records it once", async () => {
    const { send, outbound, sentEvents } = await crmConversation();
    const first = await send("reply-attempt-1");
    const again = await send("reply-attempt-1");
    assert.equal(again?.id, first?.id);
    assert.equal((await outbound()).length, 1);
    assert.equal((await sentEvents()).length, 1);
  });

  it("stores one message when the same send arrives twice at once", async () => {
    const { send, outbound, sentEvents } = await crmConversation();
    const [a, b] = await Promise.all([send("reply-attempt-2"), send("reply-attempt-2")]);
    assert.ok(a && b);
    assert.equal(a.id, b.id);
    assert.equal((await outbound()).length, 1);
    assert.equal((await sentEvents()).length, 1);
  });

  it("sends a new message for a new key, and for every request without one", async () => {
    const { send, outbound } = await crmConversation();
    await send("reply-attempt-3");
    await send("reply-attempt-4");
    await send();
    await send();
    assert.equal((await outbound()).length, 4);
  });

  it("still answers a repeat after the conversation was closed, but refuses a new message", async () => {
    const { crm, captured, send } = await crmConversation();
    const first = await send("reply-attempt-5");
    await crm.setControl("org_a", captured.conversation.id, "closed", "owner");
    assert.equal((await send("reply-attempt-5"))?.id, first?.id);
    await assert.rejects(send("reply-attempt-6"), /closed/);
  });
});

describe("review requests: one per completed appointment", () => {
  async function completedTwice(parallel: boolean) {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.upsertOrgSettings("org_g", { googleReviewUrl: "https://g.page/r/example" });
    const appt = await store.createAppointment({
      organizationId: "org_g",
      title: "Job done",
      startsAt: new Date().toISOString(),
      status: "scheduled",
      source: "manual",
      customerPhoneE164: "+15145550202",
      customerName: "Lee",
    });
    const complete = () =>
      services.completeAppointmentAndMaybeReview({
        organizationId: "org_g",
        appointmentId: appt.id,
        scheduleReviewHours: 0,
      });
    if (parallel) await Promise.all([complete(), complete()]);
    else {
      await complete();
      await complete();
    }
    await services.processReviewRequests({
      businessNameForOrg: async () => "Nord",
      smsFromForOrg: async () => "+15145550999",
    });
    return { store, sms };
  }

  it("texts the customer once when the appointment is completed twice", async () => {
    const { store, sms } = await completedTwice(false);
    assert.equal((await store.listReviewRequests("org_g")).length, 1);
    assert.equal(sms.sent.length, 1);
  });

  it("texts the customer once when both completions race", async () => {
    const { store, sms } = await completedTwice(true);
    assert.equal((await store.listReviewRequests("org_g")).length, 1);
    assert.equal(sms.sent.length, 1);
  });
});

describe("platform announcements: one per business per key", () => {
  function notifications() {
    const store = createMemoryNotificationStore();
    const service = createNotificationService({
      store,
      now: () => new Date("2026-11-21T12:00:00.000Z"),
      listMembers: async () => [],
      loadOrg: async (id) => ({
        id,
        name: id,
        status: "active",
        timezone: "America/Toronto",
        localeDefault: "en",
        phoneE164: "+15145550999",
        accountType: "production",
      }),
      sendSms: async () => ({ sent: true, sid: "SMtest" }),
      sendEmail: async () => ({ sent: true }),
    });
    const announce = (idempotencyKey?: string) =>
      queueAnnouncement({
        organizationIds: ["org_a", "org_b"],
        message: "Maintenance tonight",
        idempotencyKey,
        enqueue: (event) => service.enqueue(event),
      });
    const pending = async () =>
      (await store.claimOutbox(100, "2026-11-21T12:00:00.000Z")).length;
    return { announce, pending };
  }

  it("queues nothing new when the same announcement is sent again", async () => {
    const { announce, pending } = notifications();
    assert.deepEqual(await announce("announce-attempt-1"), { queued: 2, alreadyQueued: 0 });
    assert.deepEqual(await announce("announce-attempt-1"), { queued: 0, alreadyQueued: 2 });
    assert.equal(await pending(), 2);
  });

  it("queues once when both requests race", async () => {
    const { announce, pending } = notifications();
    await Promise.all([announce("announce-attempt-2"), announce("announce-attempt-2")]);
    assert.equal(await pending(), 2);
  });

  it("treats a new key as a new announcement", async () => {
    const { announce, pending } = notifications();
    await announce("announce-attempt-3");
    await announce("announce-attempt-4");
    assert.equal(await pending(), 4);
  });
});
