import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createCrmService } from "../../src/product/crm/service";
import { createPostgresCrmStore } from "../../src/product/crm/postgres-store";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createPostgresStore } from "../../src/product/missed-call/postgres-store";
import type { OutboundMessageRecord } from "../../src/product/missed-call/types";
import {
  createPostgresSmsInbox,
  drainSmsInbox,
  type SmsInbox,
  type SmsInboxMessage,
} from "../../src/product/sms-receptionist/inbox";

/**
 * The inbox's ordering, lease and retry guarantees are SQL, so they are proven
 * against a real PostgreSQL, not a mock. Disposable loopback database only; each
 * run works in its own schema and drops it afterwards.
 */
const url = process.env.SMS_INBOX_TEST_DATABASE_URL;
describe("SMS inbox and CRM history in isolated PostgreSQL", { skip: !url }, () => {
  const schema = "sms_inbox_test_" + crypto.randomUUID().replaceAll("-", "");
  const sql = (file: string) => readFileSync(file, "utf8");
  let admin: Pool;
  let pool: Pool;
  let inbox: SmsInbox;
  let scopedUrl: string;
  let seq = 0;

  const msg = (
    id: string,
    over: Partial<SmsInboxMessage> = {},
  ): SmsInboxMessage => ({
    id,
    organizationId: "org_a",
    clientId: "client_a",
    fromE164: "+15145550001",
    toE164: "+14385550100",
    params: { Body: `text ${id}` },
    ...over,
  });
  const fresh = (label: string) => `SM${label}_${++seq}_${Date.now()}`;
  const row = async (id: string) =>
    (await pool.query("SELECT * FROM mc_sms_inbox WHERE id=$1", [id])).rows[0];
  const expire = (id: string) =>
    pool.query("UPDATE mc_sms_inbox SET lease_until=now()-interval '1 second' WHERE id=$1", [id]);
  const due = (id: string) =>
    pool.query("UPDATE mc_sms_inbox SET available_at=now() WHERE id=$1", [id]);

  before(async () => {
    const target = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname),
      "Local disposable PostgreSQL required",
    );
    assert.match(
      target.pathname,
      /^\/tc\d+_staging$/,
      "Explicit test database required",
    );
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const options = `-c search_path=${schema}`;
    const scoped = new URL(url!);
    scoped.searchParams.set("options", options);
    scopedUrl = scoped.href;
    pool = new Pool({ connectionString: url, options, max: 16 });
    for (const file of [
      "src/product/missed-call/schema.sql",
      "src/product/saas/schema.sql",
      "src/product/crm/schema.sql",
      "src/product/sms-receptionist/schema.sql",
    ])
      await pool.query(sql(file));
    // A rerun of the migration must change nothing.
    await pool.query(sql("src/product/sms-receptionist/schema.sql"));
    for (const org of ["org_a", "org_b"])
      await pool.query(
        "INSERT INTO tc_organizations (id,name,slug) VALUES ($1,$2,$3)",
        [org, org, `${org}-${schema}`],
      );
    inbox = createPostgresSmsInbox(pool);
  });
  after(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("stores a redelivered webhook once, and never resurrects a finished message", async () => {
    const id = fresh("dup");
    await Promise.all([inbox.enqueue(msg(id)), inbox.enqueue(msg(id)), inbox.enqueue(msg(id))]);
    assert.equal(
      (await pool.query("SELECT 1 FROM mc_sms_inbox WHERE id=$1", [id])).rowCount,
      1,
    );
    const job = await inbox.claim(id);
    assert.ok(job);
    await inbox.finish(job);
    await inbox.enqueue(msg(id)); // Twilio redelivers after we finished.
    assert.equal(await inbox.claim(id), null, "no second AI reply for a handled text");
    assert.equal((await row(id)).state, "done");
  });

  it("accepts nothing for an organization that does not exist", async () => {
    await assert.rejects(
      () => inbox.enqueue(msg(fresh("ghost"), { organizationId: "org_missing" })),
      (error: { code?: string }) => error.code === "23503",
    );
  });

  it("lets only the oldest text of a conversation be claimed, across many parallel claimers", async () => {
    const [a1, a2, b1, other] = [fresh("a1"), fresh("a2"), fresh("b1"), fresh("o1")];
    await inbox.enqueue(msg(a1, { fromE164: "+15145550011" }));
    await inbox.enqueue(msg(a2, { fromE164: "+15145550011" }));
    await inbox.enqueue(msg(b1, { fromE164: "+15145550012" }));
    // Same numbers, different tenant: an independent conversation.
    await inbox.enqueue(
      msg(other, { fromE164: "+15145550011", organizationId: "org_b", clientId: "client_b" }),
    );
    const claimed = (
      await Promise.all(Array.from({ length: 12 }, () => inbox.claim()))
    )
      .filter((job): job is NonNullable<typeof job> => Boolean(job))
      .filter((job) => [a1, a2, b1, other].includes(job.id))
      .map((job) => job.id)
      .sort();
    assert.deepEqual(claimed, [a1, b1, other].sort());
    assert.ok(!claimed.includes(a2), "a follow-up must wait for its predecessor");
  });

  it("keeps per-conversation order and processes every text once under concurrent workers", async () => {
    const conversations = Array.from({ length: 6 }, (_, i) => `+1514555${String(200 + i)}`);
    const perConversation = 8;
    const expected = new Map<string, string[]>();
    for (let n = 0; n < perConversation; n++)
      for (const from of conversations) {
        const id = fresh(`c${from.slice(-3)}n${n}`);
        expected.set(from, [...(expected.get(from) ?? []), id]);
        await inbox.enqueue(msg(id, { fromE164: from, params: { Body: id } }));
      }
    const seen = new Map<string, string[]>();
    const handled = new Set<string>();
    const inFlight = new Set<string>();
    const handler = async (job: { id: string; fromE164: string }) => {
      assert.ok(!handled.has(job.id), `${job.id} processed twice`);
      assert.ok(!inFlight.has(job.fromE164), "two texts of one conversation overlapped");
      inFlight.add(job.fromE164);
      await new Promise((r) => setTimeout(r, Math.random() * 15));
      seen.set(job.fromE164, [...(seen.get(job.fromE164) ?? []), job.id]);
      handled.add(job.id);
      inFlight.delete(job.fromE164);
    };
    const total = conversations.length * perConversation;
    const deadline = Date.now() + 30_000;
    while (handled.size < total && Date.now() < deadline) {
      await Promise.all(
        Array.from({ length: 8 }, () => drainSmsInbox(inbox, handler, { budgetMs: 5_000 })),
      );
    }
    assert.equal(handled.size, total);
    for (const [from, ids] of expected) assert.deepEqual(seen.get(from), ids, from);
    const left = await pool.query(
      "SELECT count(*)::int AS n FROM mc_sms_inbox WHERE id = ANY($1) AND (state<>'done' OR params<>'{}'::jsonb)",
      [[...expected.values()].flat()],
    );
    assert.equal(left.rows[0].n, 0, "finished texts are done and their body is erased");
  });

  it("recovers a crashed worker after its lease and ignores the stale worker's completion", async () => {
    const id = fresh("crash");
    await inbox.enqueue(msg(id, { fromE164: "+15145550031" }));
    const crashed = await inbox.claim(id);
    assert.ok(crashed);
    assert.equal(await inbox.claim(id), null, "a live lease cannot be taken over");
    await expire(id);
    const resumed = await inbox.claim(id);
    assert.ok(resumed);
    assert.notEqual(resumed.token, crashed.token);
    assert.equal(resumed.attempts, 2);
    await inbox.finish(crashed); // the zombie wakes up and reports success
    assert.equal((await row(id)).state, "processing", "stale completion must not release the claim");
    await inbox.finish(resumed);
    assert.equal((await row(id)).state, "done");
  });

  it("retries a failed text with a delay, holds the follow-up, then gives up after five attempts", async () => {
    const [first, follow] = [fresh("fail"), fresh("after")];
    const from = "+15145550041";
    await inbox.enqueue(msg(first, { fromE164: from, params: { Body: "private customer text" } }));
    await inbox.enqueue(msg(follow, { fromE164: from }));
    for (let attempt = 1; attempt <= 5; attempt++) {
      const job = await inbox.claim(first);
      assert.ok(job, `attempt ${attempt} is claimable`);
      assert.equal(job.attempts, attempt);
      await inbox.finish(job, "TemporaryError");
      const after = await row(first);
      assert.equal(after.state, attempt === 5 ? "dead" : "pending");
      assert.equal(after.last_error, "TemporaryError", "an error name only, never the text");
      if (attempt < 5) {
        assert.equal(await inbox.claim(first), null, "retry waits out its delay");
        assert.equal(await inbox.claim(follow), null, "the follow-up waits for the earlier text");
        await due(first);
      }
    }
    const released = await inbox.claim(follow);
    assert.equal(released?.id, follow, "a dead text no longer blocks the conversation");
  });

  it("purges only finished and dead messages older than the retention window", async () => {
    const [done, pending] = [fresh("old_done"), fresh("old_pending")];
    await inbox.enqueue(msg(done, { fromE164: "+15145550051" }));
    await inbox.enqueue(msg(pending, { fromE164: "+15145550052" }));
    const job = await inbox.claim(done);
    await inbox.finish(job!);
    await pool.query(
      "UPDATE mc_sms_inbox SET updated_at=now()-interval '31 days' WHERE id = ANY($1)",
      [[done, pending]],
    );
    await inbox.purge();
    assert.equal(await row(done), undefined);
    assert.equal((await row(pending)).state, "pending");
  });

  it("gives the AI the newest messages of a long conversation, oldest first", async () => {
    const store = createPostgresCrmStore(scopedUrl);
    const crm = createCrmService(store);
    const phone = "+15145550099";
    const start = Date.parse("2026-01-01T12:00:00Z");
    for (let i = 0; i < 120; i++)
      await crm.capture({
        organizationId: "org_a",
        source: "sms",
        phoneE164: phone,
        actor: "sms",
        now: new Date(start + i * 60_000),
        message: {
          direction: i % 2 === 0 ? "inbound" : "outbound",
          body: `message ${i}`,
          fromE164: phone,
          toE164: "+14385550100",
          automated: i % 2 === 1,
          providerMessageSid: `SMhist${i}`,
          deliveryStatus: "delivered",
        },
      });
    const customer = await store.findCustomerByPhone("org_a", phone);
    const conversation = await store.findLatestConversation("org_a", customer!.id);
    const window = await store.listMessages("org_a", conversation!.id, 40);
    assert.equal(window.length, 40);
    assert.equal(window[0].body, "message 80", "starts 40 messages back, not at the beginning");
    assert.equal(window.at(-1)!.body, "message 119", "ends with the customer's latest text");
    assert.deepEqual(
      window.map((m) => m.body),
      Array.from({ length: 40 }, (_, i) => `message ${80 + i}`),
      "chronological",
    );
    assert.equal((await store.listMessages("org_a", conversation!.id)).length, 120);
    // The same query for another tenant's id space returns nothing.
    assert.deepEqual(await store.listMessages("org_b", conversation!.id, 40), []);
  });

  describe("outbound reply delivery state", () => {
    let store: ReturnType<typeof createPostgresStore>;
    const outbound = async (id: string) =>
      (await pool.query("SELECT * FROM mc_outbound_messages WHERE id=$1", [id]))
        .rows[0];
    const queue = async (
      id: string,
      over: Partial<OutboundMessageRecord> = {},
    ) => {
      const at = new Date().toISOString();
      await store.enqueueOutbound({
        id,
        clientAccountId: "client_out",
        toE164: "+15145550061",
        fromE164: "+14385550100",
        body: "Bonjour",
        detail: "sms_receptionist",
        status: "queued",
        attempts: 0,
        createdAt: at,
        updatedAt: at,
        ...over,
      });
    };
    const age = (id: string) =>
      pool.query(
        "UPDATE mc_outbound_messages SET updated_at=now()-interval '10 minutes' WHERE id=$1",
        [id],
      );

    before(async () => {
      store = createPostgresStore(scopedUrl);
      await store.saveClient(demoClientAccount({ id: "client_out" }));
    });

    it("reconciles a delivery callback that beats the send's own bookkeeping, and is never downgraded", async () => {
      const id = fresh("smsrep_race");
      await queue(id);
      assert.equal((await store.claimOutboundById(id))?.status, "sending");
      // Twilio's callback arrives before markOutboundSent has run.
      const updated = await store.applyOutboundProviderStatus("SMrace1", "delivered", id);
      assert.equal(updated?.status, "delivered");
      assert.equal(updated?.providerSid, "SMrace1");
      await store.markOutboundSent(id, "SMrace1"); // the slow writer finally runs
      const final = await outbound(id);
      assert.equal(final.status, "delivered", "a late 'sent' must not erase 'delivered'");
      assert.equal(final.provider_sid, "SMrace1");
    });

    it("never resends a failed customer reply, but still retries ordinary workflow texts", async () => {
      const reply = fresh("smsrep_fail");
      await queue(reply);
      await store.claimOutboundById(reply);
      await store.markOutboundSent(reply, "SMfail_reply");
      assert.equal(
        (await store.applyOutboundProviderStatus("SMfail_reply", "undelivered", reply))?.status,
        "undelivered",
      );
      // A later, out-of-order "sent" callback cannot revive it.
      assert.equal(
        (await store.applyOutboundProviderStatus("SMfail_reply", "sent", reply))?.status,
        "undelivered",
      );

      const plain = fresh("workflow_fail");
      await queue(plain, { detail: undefined });
      await store.claimOutboundById(plain);
      await store.markOutboundSent(plain, "SMfail_plain");
      assert.equal(
        (await store.applyOutboundProviderStatus("SMfail_plain", "undelivered"))?.status,
        "retry",
      );
      assert.equal((await outbound(plain)).provider_sid, null, "cleared so the retry can send");
    });

    it("marks an orphaned in-flight reply uncertain instead of texting the customer twice", async () => {
      const orphan = fresh("smsrep_orphan");
      const plainOrphan = fresh("workflow_orphan");
      await queue(orphan);
      await queue(plainOrphan, { detail: undefined });
      await store.claimOutboundById(orphan);
      await store.claimOutboundById(plainOrphan);
      await age(orphan);
      await age(plainOrphan);

      const claimed = (await store.claimOutboundForSend(50, 5 * 60_000)).map((m) => m.id);
      assert.ok(!claimed.includes(orphan), "a customer reply that may have been sent is not resent");
      assert.ok(claimed.includes(plainOrphan), "an ordinary workflow text is still reclaimed");
      assert.equal((await outbound(orphan)).status, "uncertain");
      assert.ok((await store.getOutboundQueueStats()).uncertain >= 1, "ops can see it");

      // Twilio's callback, matched by outbox id, resolves the doubt.
      const resolved = await store.applyOutboundProviderStatus("SMorphan1", "delivered", orphan);
      assert.equal(resolved?.status, "delivered");
    });
  });
});
