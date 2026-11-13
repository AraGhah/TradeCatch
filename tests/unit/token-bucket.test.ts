import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MemoryBuckets,
  RefusalMemo,
  specFromWindow,
  takeTokens,
  type BucketSpec,
} from "../../src/lib/token-bucket";

const SEC = 1_000;

/** Drive the pure function the way a store would: carry `fullAt` between calls. */
function bucket(spec: BucketSpec) {
  let fullAt: number | null = null;
  return (now: number, cost = 1) => {
    const result = takeTokens(spec, fullAt, now, cost);
    fullAt = result.fullAt;
    return result.decision;
  };
}

describe("token bucket arithmetic", () => {
  it("lets a burst of `capacity` through at once, then refuses", () => {
    const take = bucket({ capacity: 5, refillEveryMs: 10 * SEC });
    const results = Array.from({ length: 8 }, () => take(1_000_000));
    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, true, true, false, false, false],
    );
    assert.deepEqual(
      results.map((r) => r.remaining),
      [4, 3, 2, 1, 0, 0, 0, 0],
    );
  });

  it("says exactly when the next request will be allowed, and is right", () => {
    const spec = { capacity: 2, refillEveryMs: 30 * SEC };
    const take = bucket(spec);
    const t0 = 5_000_000;
    take(t0);
    take(t0);
    const refused = take(t0 + 1_000);
    assert.equal(refused.allowed, false);
    assert.equal(refused.retryAfterMs, 29_000);
    // One millisecond early: still refused, and the wait shrinks by that much.
    const early = take(t0 + 1_000 + 28_999);
    assert.equal(early.allowed, false);
    assert.equal(early.retryAfterMs, 1);
    // On time: allowed.
    assert.equal(take(t0 + 30_000).allowed, true);
  });

  it("does not charge for refused requests (hammering does not extend the wait)", () => {
    const take = bucket({ capacity: 1, refillEveryMs: 60 * SEC });
    const t0 = 9_000_000;
    take(t0);
    for (let i = 1; i <= 100; i += 1) assert.equal(take(t0 + i).allowed, false);
    assert.equal(take(t0 + 60_000).allowed, true);
  });

  it("refills one token per interval up to capacity and no further", () => {
    const take = bucket({ capacity: 3, refillEveryMs: 10 * SEC });
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i += 1) take(t0);
    assert.equal(take(t0).allowed, false);
    // 25 s later: two tokens are back (the third is half way).
    assert.equal(take(t0 + 25_000).remaining, 1);
    assert.equal(take(t0 + 25_000).remaining, 0);
    assert.equal(take(t0 + 25_000).allowed, false);
    // A day later: full, not "full plus a day of credit".
    const results = Array.from({ length: 5 }, () => take(t0 + 86_400_000));
    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, false, false],
    );
  });

  it("charges `cost` tokens and refuses a request that does not fit", () => {
    const take = bucket({ capacity: 10, refillEveryMs: 1 * SEC });
    const t0 = 2_000_000;
    assert.equal(take(t0, 4).remaining, 6);
    assert.equal(take(t0, 4).remaining, 2);
    const refused = take(t0, 4);
    assert.equal(refused.allowed, false);
    assert.equal(refused.retryAfterMs, 2_000);
    // A smaller request still fits: refusal was about this request's size.
    assert.equal(take(t0, 2).allowed, true);
  });

  it("rejects impossible buckets and requests instead of silently allowing them", () => {
    assert.throws(() => takeTokens({ capacity: 0, refillEveryMs: 1000 }, null, 0));
    assert.throws(() => takeTokens({ capacity: 5, refillEveryMs: 0 }, null, 0));
    assert.throws(() => takeTokens({ capacity: 5, refillEveryMs: NaN }, null, 0));
    assert.throws(() => takeTokens({ capacity: 5, refillEveryMs: 1000 }, null, 0, 6));
    assert.throws(() => takeTokens({ capacity: 5, refillEveryMs: 1000 }, null, 0, 0));
  });

  it("maps 'N per window' to a burst of N refilling over the window", () => {
    assert.deepEqual(specFromWindow(20, 15 * 60 * SEC), {
      capacity: 20,
      refillEveryMs: 45 * SEC,
    });
    // A fractional interval still admits exactly `limit` immediately.
    const take = bucket(specFromWindow(7, 60 * SEC));
    const allowed = Array.from({ length: 12 }, () => take(3_000_000)).filter(
      (r) => r.allowed,
    ).length;
    assert.equal(allowed, 7);
  });

  it("agrees with a textbook token bucket on thousands of random requests", () => {
    // Reference: float token count topped up from elapsed time on every call.
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (const spec of [
      { capacity: 1, refillEveryMs: 1000 },
      { capacity: 5, refillEveryMs: 250 },
      { capacity: 20, refillEveryMs: 45_000 },
      { capacity: 60, refillEveryMs: 1000 },
      { capacity: 7, refillEveryMs: 8571.428571 },
    ]) {
      const take = bucket(spec);
      let tokens = spec.capacity;
      let last = 0;
      let now = 1_000_000;
      for (let i = 0; i < 2_000; i += 1) {
        // Mostly rapid fire, sometimes a pause long enough to matter.
        now += random() < 0.7 ? Math.floor(random() * 40) : Math.floor(random() * spec.refillEveryMs * 4);
        const cost = random() < 0.9 ? 1 : Math.min(spec.capacity, 2);
        tokens = Math.min(spec.capacity, tokens + (now - (last || now)) / spec.refillEveryMs);
        last = now;
        const expected = tokens >= cost - 1e-9;
        if (expected) tokens -= cost;
        const actual = take(now, cost).allowed;
        assert.equal(
          actual,
          expected,
          `capacity ${spec.capacity}, refill ${spec.refillEveryMs} ms, request ${i} at ${now}`,
        );
      }
    }
  });
});

describe("MemoryBuckets", () => {
  it("allows exactly `capacity` of 50 rapid requests, then recovers as time passes", () => {
    let now = 10_000_000;
    const buckets = new MemoryBuckets(100, () => now);
    const spec = { capacity: 20, refillEveryMs: 3 * SEC };
    const burst = Array.from({ length: 50 }, () => buckets.take("k", spec));
    assert.equal(burst.filter((r) => r.allowed).length, 20);
    assert.equal(burst.filter((r) => !r.allowed).length, 30);
    // Refused callers are told how long to wait; it never reads "0".
    assert.ok(burst.slice(20).every((r) => r.retryAfterMs >= 1 && r.retryAfterMs <= 3 * SEC));

    now += 3 * SEC;
    assert.equal(buckets.take("k", spec).allowed, true);
    assert.equal(buckets.take("k", spec).allowed, false);
    now += 60 * SEC;
    assert.equal(buckets.take("k", spec).remaining, 19);
  });

  it("keeps keys independent", () => {
    const buckets = new MemoryBuckets(100, () => 1);
    const spec = { capacity: 1, refillEveryMs: 1000 };
    assert.equal(buckets.take("a", spec).allowed, true);
    assert.equal(buckets.take("a", spec).allowed, false);
    assert.equal(buckets.take("b", spec).allowed, true);
  });

  it("stays bounded when keys come from the network, dropping refilled buckets first", () => {
    let now = 1_000;
    const buckets = new MemoryBuckets(50, () => now);
    const spec = { capacity: 1, refillEveryMs: 1000 };
    for (let i = 0; i < 40; i += 1) buckets.take(`old-${i}`, spec);
    now += 5_000; // every old bucket has refilled: it is the same as no bucket
    for (let i = 0; i < 40; i += 1) buckets.take(`new-${i}`, spec);
    assert.ok(buckets.size <= 50);
    // The live buckets survived; the refilled ones were what got dropped.
    assert.equal(buckets.take("new-39", spec).allowed, false);
    // A flood of distinct live keys cannot grow it without limit either.
    for (let i = 0; i < 5_000; i += 1) buckets.take(`flood-${i}`, spec);
    assert.ok(buckets.size <= 50);
  });
});

describe("RefusalMemo", () => {
  it("repeats a refusal only until its Retry-After has passed", () => {
    let now = 1_000;
    const memo = new RefusalMemo(10, () => now);
    assert.equal(memo.remainingMs("k"), 0);
    memo.remember("k", 5_000);
    assert.equal(memo.remainingMs("k"), 5_000);
    now += 2_000;
    assert.equal(memo.remainingMs("k"), 3_000);
    now += 3_000;
    assert.equal(memo.remainingMs("k"), 0);
    assert.equal(memo.remainingMs("k"), 0);
  });

  it("is bounded", () => {
    const memo = new RefusalMemo(20, () => 1);
    for (let i = 0; i < 1_000; i += 1) memo.remember(`k${i}`, 60_000);
    let remembered = 0;
    for (let i = 0; i < 1_000; i += 1) if (memo.remainingMs(`k${i}`) > 0) remembered += 1;
    assert.ok(remembered <= 20);
  });
});
