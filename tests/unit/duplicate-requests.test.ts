import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttemptKey } from "../../src/lib/client/attempt-key";
import { createSingleFlight } from "../../src/lib/client/use-single-flight";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
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
