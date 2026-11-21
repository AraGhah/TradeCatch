import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createObserver,
  scopeOf,
} from "../../src/product/reliability/observations";
import type { BucketDelta } from "../../src/product/reliability/types";

const T0 = Date.parse("2026-11-20T15:00:10.000Z");
const MIN = 60_000;

function observer(extra: Partial<Parameters<typeof createObserver>[0]> = {}) {
  let clock = T0;
  const o = createObserver({
    now: () => clock,
    flushEveryMs: 30_000,
    maxBuckets: 5,
    breakerMs: [60_000, 300_000],
    sinkTimeoutMs: 50,
    ...extra,
  });
  return { o, advance: (ms: number) => void (clock += ms) };
}

describe("what counts as a request", () => {
  it("separates API and page traffic and ignores static assets", () => {
    assert.equal(scopeOf("/api/health"), "api");
    assert.equal(scopeOf("/api/businesses/abc/calls"), "api");
    assert.equal(scopeOf("/en/pricing"), "page");
    assert.equal(scopeOf("/"), "page");
    assert.equal(scopeOf("/admin/system-health"), "page");
    assert.equal(scopeOf("/_next/static/chunks/a.js"), null);
    assert.equal(scopeOf("/_next/image"), null);
    assert.equal(scopeOf("/favicon.ico"), null);
    assert.equal(scopeOf("/images/logo.png"), null);
    assert.equal(scopeOf("/robots.txt"), null);
  });
});

describe("recording", () => {
  it("counts each status class and fills the latency histogram", async () => {
    const { o } = observer();
    for (const [status, ms] of [
      [200, 50],
      [301, 120],
      [401, 300],
      [403, 700],
      [429, 1500],
      [404, 4000],
      [500, 6000],
      [503, 90],
    ] as const)
      o.record({ pathname: "/api/x", status, durationMs: ms });
    let rows: BucketDelta[] = [];
    await o.flush(async (r) => void (rows = r), true);
    assert.equal(rows.length, 1);
    const b = rows[0];
    assert.equal(b.scope, "api");
    assert.equal(b.total, 8);
    assert.equal(b.s2xx, 1);
    assert.equal(b.s3xx, 1);
    assert.equal(b.s401, 1);
    assert.equal(b.s403, 1);
    assert.equal(b.s429, 1);
    assert.equal(b.s4xxOther, 1);
    assert.equal(b.s5xx, 2);
    // <=100: 50,90  <=250: 120  <=500: 300  <=1000: 700  <=2500: 1500  <=5000: 4000  over: 6000
    assert.deepEqual(b.lat, [2, 1, 1, 1, 1, 1, 1]);
    assert.equal(b.lat.reduce((a, c) => a + c, 0), b.total);
  });

  it("keeps one bucket per minute and scope", async () => {
    const { o, advance } = observer();
    o.record({ pathname: "/api/a", status: 200, durationMs: 10 });
    o.record({ pathname: "/pricing", status: 200, durationMs: 10 });
    advance(MIN);
    o.record({ pathname: "/api/a", status: 500, durationMs: 10 });
    let rows: BucketDelta[] = [];
    await o.flush(async (r) => void (rows = r), true);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => Date.parse(r.at) % MIN === 0), "bucket times are whole minutes");
  });

  it("stores counts only: nothing about the path, user or body can reach the sink", async () => {
    const { o } = observer();
    o.record({ pathname: "/api/businesses/secret-id/calls", status: 200, durationMs: 5 });
    let rows: BucketDelta[] = [];
    await o.flush(async (r) => void (rows = r), true);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["at", "lat", "s2xx", "s3xx", "s401", "s403", "s429", "s4xxOther", "s5xx", "scope", "total"]);
    assert.equal(JSON.stringify(rows).includes("secret-id"), false);
  });

  it("never throws, whatever it is given", () => {
    const { o } = observer();
    for (const input of [
      { pathname: "/api/x", status: Number.NaN, durationMs: 5 },
      { pathname: "/api/x", status: 200, durationMs: Number.NaN },
      { pathname: "/api/x", status: -5, durationMs: -9 },
      { pathname: undefined as unknown as string, status: 200, durationMs: 1 },
      { pathname: "/api/x", status: 999999, durationMs: Infinity },
    ])
      assert.doesNotThrow(() => o.record(input));
  });

  it("is bounded: only the newest buckets are kept", () => {
    const { o, advance } = observer();
    for (let i = 0; i < 50; i += 1) {
      o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
      advance(MIN);
    }
    assert.ok(o.pending() <= 5);
  });
});

describe("flushing", () => {
  it("is due only after the interval and only when there is data", async () => {
    const { o, advance } = observer();
    assert.equal(o.due(), false, "nothing recorded");
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(o.due(), true, "first flush is not delayed");
    await o.flush(async () => undefined);
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(o.due(), false, "just flushed");
    advance(31_000);
    assert.equal(o.due(), true);
  });

  it("does not call the sink when there is nothing to send, and clears what it sent", async () => {
    const { o } = observer();
    let calls = 0;
    assert.equal(await o.flush(async () => void (calls += 1), true), "empty");
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(await o.flush(async () => void (calls += 1), true), "sent");
    assert.equal(o.pending(), 0);
    assert.equal(calls, 1);
  });

  it("MON-16: a failing sink opens a breaker so a broken database is not hammered, and never throws", async () => {
    const { o, advance } = observer();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("database password=hunter2 unavailable");
    };
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(await o.flush(failing, true), "failed");
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(o.due(), false, "breaker is open");
    assert.equal(await o.flush(failing), "skipped");
    assert.equal(calls, 1);
    advance(61_000);
    assert.equal(o.due(), true);
    assert.equal(await o.flush(failing), "failed");
    advance(61_000);
    assert.equal(o.due(), false, "second failure backs off for longer");
    advance(300_000);
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(await o.flush(async () => undefined), "sent");
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    assert.equal(o.due(), false, "a success resets the breaker and the interval timer starts again");
  });

  it("MON-16: a sink that never answers is cut off by the timeout", async () => {
    const { o } = observer();
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    const outcome = await o.flush(() => new Promise<void>(() => undefined), true);
    assert.equal(outcome, "failed");
  });

  it("does not run two flushes at once", async () => {
    const { o } = observer({ sinkTimeoutMs: 1000 });
    o.record({ pathname: "/api/x", status: 200, durationMs: 5 });
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
    };
    const [a, b] = await Promise.all([o.flush(slow, true), o.flush(slow, true)]);
    assert.deepEqual([a, b].sort(), ["sent", "skipped"]);
    assert.equal(calls, 1);
  });
});
