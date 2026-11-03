import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMemorySmsInbox,
  drainSmsInbox,
  type SmsInboxMessage,
} from "../../src/product/sms-receptionist/inbox";

const message = (id: string, org = "org_a"): SmsInboxMessage => ({
  id,
  organizationId: org,
  clientId: `client_${org}`,
  fromE164: "+15145550000",
  toE164: "+14385550000",
  params: { Body: id },
});

test("persisted duplicate receipts yield one job; concurrent follow-ups stay ordered and tenant-isolated", async () => {
  const inbox = createMemorySmsInbox();
  await inbox.enqueue(message("SM1"));
  await inbox.enqueue(message("SM1"));
  await inbox.enqueue(message("SM2"));
  await inbox.enqueue(message("SM3", "org_b"));
  const first = await inbox.claim();
  assert.equal(first?.id, "SM1");
  const parallel = await inbox.claim();
  assert.equal(parallel?.id, "SM3");
  assert.equal(await inbox.claim(), null);
  await inbox.finish(first!);
  assert.equal((await inbox.claim())?.id, "SM2");
});

test("a crashed worker is recovered after its lease; stale completion cannot release the new claim", async () => {
  let now = 0;
  const inbox = createMemorySmsInbox(() => now);
  await inbox.enqueue(message("SM1"));
  const crashed = await inbox.claim();
  now = 121_000;
  const resumed = await inbox.claim();
  assert.equal(resumed?.id, "SM1");
  assert.notEqual(resumed?.token, crashed?.token);
  await inbox.finish(crashed!);
  assert.equal(await inbox.claim(), null);
  await inbox.finish(resumed!);
  assert.equal(await inbox.claim(), null);
});

test("processing failure is retained and retried, with bounded attempts", async () => {
  let now = 0;
  const inbox = createMemorySmsInbox(() => now);
  await inbox.enqueue(message("SM1"));
  let calls = 0;
  for (let i = 0; i < 5; i++) {
    const result = await drainSmsInbox(inbox, async () => {
      calls++;
      throw new Error("private customer body");
    });
    assert.equal(result.failed, 1);
    now += 61_000;
  }
  assert.equal(calls, 5);
  assert.equal(await inbox.claim(), null);
});

test("successful retry unlocks the follow-up and retains its original payload", async () => {
  let now = 0;
  const inbox = createMemorySmsInbox(() => now);
  await inbox.enqueue(message("SM1"));
  await inbox.enqueue(message("SM2"));
  const first = await inbox.claim();
  await inbox.finish(first!, "TemporaryError");
  assert.equal(await inbox.claim(), null);
  now += 61_000;
  const bodies: string[] = [];
  const result = await drainSmsInbox(inbox, async (job) => {
    bodies.push(job.params.Body);
  });
  assert.equal(result.processed, 2);
  assert.deepEqual(bodies, ["SM1", "SM2"]);
});
