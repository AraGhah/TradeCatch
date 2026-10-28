import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Pool } from "pg";
import { withPostgresRequestScope } from "../../src/lib/postgres-pool";
import { createPostgresProfileStore } from "../../src/product/receptionist/profile-store";
import { createPostgresCallEventStore } from "../../src/product/telephony/call-events";

test("cached receptionist stores use fresh sockets across Worker invocations and close them", async () => {
  const marker = Object.getOwnPropertyDescriptor(globalThis, "WebSocketPair");
  Object.defineProperty(globalThis, "WebSocketPair", {
    value: class {},
    configurable: true,
  });
  const used: Pool[] = [];
  const ended: Pool[] = [];
  mock.method(Pool.prototype, "query", async function (this: Pool) {
    used.push(this);
    assert.equal(this.listenerCount("error"), 1);
    return { rows: [] };
  });
  mock.method(Pool.prototype, "end", async function (this: Pool) {
    ended.push(this);
  });
  try {
    const url =
      "postgres://fixture:fixture@localhost:1/receptionist-worker-test";
    const profiles = createPostgresProfileStore(url);
    const events = createPostgresCallEventStore(url);
    for (let i = 0; i < 2; i++) {
      await withPostgresRequestScope(async () => {
        await profiles.listActivatedProfiles();
        await profiles.getProfile("org_fixture");
        await events.seenRecently({ callSid: "CAfixture", kind: "incoming" });
      });
    }
    assert.equal(
      used[0],
      used[1],
      "profile queries share their invocation pool",
    );
    assert.equal(used[3], used[4]);
    assert.notEqual(
      used[0],
      used[3],
      "profiles must not reuse another invocation's socket",
    );
    assert.notEqual(
      used[2],
      used[5],
      "call events must not reuse another invocation's socket",
    );
    assert.equal(new Set(ended).size, 4);
  } finally {
    mock.restoreAll();
    if (marker) Object.defineProperty(globalThis, "WebSocketPair", marker);
    else Reflect.deleteProperty(globalThis, "WebSocketPair");
  }
});
