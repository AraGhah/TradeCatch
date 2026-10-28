import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as voice } from "../../src/app/api/webhooks/twilio/voice/route";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";

/**
 * Regression guard for the production hang on POST
 * /api/webhooks/twilio/voice ("the Workers runtime canceled this request
 * because it detected that your Worker's code had hung").
 *
 * Root cause: `refresh()`'s in-flight reload promise was stored on
 * module-global state and awaited by *any* concurrent call, including one
 * from a different Worker invocation. Each Worker invocation has its own
 * isolated I/O context; a Promise whose settlement depends on another
 * invocation's Postgres I/O cannot safely be awaited from a different
 * invocation — Cloudflare Workers does not reliably deliver that
 * resolution, so the awaiting invocation hangs forever instead of erroring.
 * A passive refresh must now serve the last good profile set instead of
 * attaching to a foreign in-flight reload.
 */

const keys = [
  "NODE_ENV",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_ENABLED",
  "RECEPTIONIST_LLM_PROVIDER",
  "MISSED_CALL_SMS_MODE",
];
const saved = new Map(keys.map((key) => [key, process.env[key]]));
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const key of keys) delete env[key];
  env.NODE_ENV = "test";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  env.MISSED_CALL_SMS_MODE = "dry-run";
  resetReceptionistRuntimeForTests();
});

afterEach(() => {
  mock.restoreAll();
  resetReceptionistRuntimeForTests();
  for (const [key, value] of saved) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

test("a passive refresh never awaits another invocation's in-flight reload", async () => {
  const rt = getReceptionistRuntime();
  let releaseFirstReload: () => void = () => {};
  const firstReloadGate = new Promise<void>((resolve) => {
    releaseFirstReload = resolve;
  });
  let calls = 0;
  mock.method(rt.profileStore, "listActivatedProfiles", async () => {
    calls += 1;
    if (calls === 1) await firstReloadGate; // simulate a slow Postgres round trip
    return [];
  });

  // Invocation A starts a passive refresh and does not await it yet — its
  // underlying Postgres read is still pending.
  const invocationA = rt.refresh();

  // Invocation B (simulating a second, concurrent Worker request) also
  // needs a refresh while A's is still in flight.
  const invocationBStartedAt = Date.now();
  await rt.refresh();
  const invocationBDurationMs = Date.now() - invocationBStartedAt;

  // B must return immediately (serving the stale/cached profile set)
  // rather than attach to A's promise: under real Cloudflare Workers I/O
  // isolation, A's promise belongs to a different invocation's context
  // and awaiting it from B could hang forever instead of settling.
  assert.ok(
    invocationBDurationMs < 200,
    `a concurrent refresh took ${invocationBDurationMs}ms — it must not wait on another invocation's in-flight reload`,
  );

  releaseFirstReload();
  await invocationA;
  assert.equal(calls, 1, "the second, concurrent call must not trigger its own duplicate reload");
});

test("force always runs and awaits its own reload, even while another passive refresh is in flight", async () => {
  const rt = getReceptionistRuntime();
  let releaseFirstReload: () => void = () => {};
  const firstReloadGate = new Promise<void>((resolve) => {
    releaseFirstReload = resolve;
  });
  let calls = 0;
  mock.method(rt.profileStore, "listActivatedProfiles", async () => {
    calls += 1;
    if (calls === 1) await firstReloadGate;
    return [];
  });

  const invocationA = rt.refresh();
  // A force refresh must create and await its own independent Promise,
  // never the foreign one invocation A is still waiting on.
  await rt.refresh(true);
  assert.equal(calls, 2, "force must trigger its own reload rather than reuse another invocation's");

  releaseFirstReload();
  await invocationA;
});

test("concurrent Twilio voice webhooks (simulated Workers runtime) both resolve instead of hanging", async () => {
  const marker = Object.getOwnPropertyDescriptor(globalThis, "WebSocketPair");
  Object.defineProperty(globalThis, "WebSocketPair", {
    value: class {},
    configurable: true,
  });
  try {
    const rt = getReceptionistRuntime();
    let releaseFirstReload: () => void = () => {};
    const firstReloadGate = new Promise<void>((resolve) => {
      releaseFirstReload = resolve;
    });
    mock.method(rt.profileStore, "listActivatedProfiles", async () => {
      await firstReloadGate; // the first webhook's refresh is mid Postgres I/O
      return [];
    });

    const requestFor = (callSid: string) =>
      new NextRequest("https://tradecatch.test/api/webhooks/twilio/voice", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          CallSid: callSid,
          To: "+14385597001",
          From: "+15145559876",
        }),
      });
    const timeout = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("request timed out")), ms),
      );

    // Invocation A: its refresh() is blocked on the Postgres read above.
    const invocationA = voice(requestFor("CA_first"));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Invocation B: a second, concurrent Worker request for a different
    // call. Under the old code this would attach to A's in-flight refresh
    // promise and could hang forever; it must resolve well under A's gate.
    const invocationB = await Promise.race([
      voice(requestFor("CA_second")),
      timeout(2000),
    ]);
    assert.equal(invocationB.status, 200);
    assert.match(await invocationB.text(), /<Response>/);

    releaseFirstReload();
    const resolvedA = await invocationA;
    assert.equal(resolvedA.status, 200);
  } finally {
    if (marker) Object.defineProperty(globalThis, "WebSocketPair", marker);
    else Reflect.deleteProperty(globalThis, "WebSocketPair");
  }
});

test("a cached, fully-settled profile set is served without re-attaching to a past invocation's promise", async () => {
  const rt = getReceptionistRuntime();
  const method = mock.method(
    rt.profileStore,
    "listActivatedProfiles",
    async () => [],
  );
  await rt.refresh(true);
  assert.equal(method.mock.callCount(), 1);

  // Within the TTL window, a passive refresh must not touch the store at all.
  await rt.refresh();
  assert.equal(method.mock.callCount(), 1);
});
