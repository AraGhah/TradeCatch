/**
 * KAN-28 recordFailure: the call every integration makes when something goes
 * wrong while serving a customer. Recording the failure must never make that
 * worse (MON-16): it cannot throw, cannot hold the request up, and backs off
 * when the database it writes to is itself struggling.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createFailureRecorder } from "../../src/product/reliability/hooks";

type Input = Parameters<ReturnType<typeof createFailureRecorder>>[0];
const input: Input = { service: "twilio_sms", operation: "send", errorCode: "twilio_503" };

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
});
afterEach(() => {
  console.warn = realWarn;
});

function harness(over: { record?: (i: Record<string, unknown>) => Promise<unknown>; timeoutMs?: number } = {}) {
  let clock = 1_000_000;
  const calls: Record<string, unknown>[] = [];
  const recorder = createFailureRecorder({
    record: async (i) => {
      calls.push(i);
      return over.record ? over.record(i) : undefined;
    },
    now: () => clock,
    timeoutMs: over.timeoutMs ?? 50,
    breakerMs: [1_000, 10_000],
  });
  return { recorder, calls, advance: (ms: number) => void (clock += ms) };
}

describe("recording a failure", () => {
  it("passes the failure on, defaulting to a retryable high-severity one", async () => {
    const { recorder, calls } = harness();
    await recorder(input);
    assert.deepEqual(calls, [{ ...input, severity: "high", retryable: true }]);
  });

  it("keeps the caller's own severity, retryability and simulation flag", async () => {
    const { recorder, calls } = harness();
    await recorder({ ...input, severity: "low", retryable: false, simulated: true, organizationId: "org_1", detail: "x" });
    assert.equal(calls[0].severity, "low");
    assert.equal(calls[0].retryable, false);
    assert.equal(calls[0].simulated, true);
    assert.equal(calls[0].organizationId, "org_1");
  });
});

describe("MON-16 it can never make the customer's request worse", () => {
  it("never throws, whether the write rejects or throws synchronously", async () => {
    await assert.doesNotReject(() => harness({ record: () => Promise.reject(new Error("db down")) }).recorder(input));
    const sync = createFailureRecorder({
      record: () => {
        throw new Error("sync boom");
      },
      timeoutMs: 50,
    });
    await assert.doesNotReject(() => sync(input));
  });

  it("does not wait for a write that never finishes", async () => {
    const { recorder } = harness({ record: () => new Promise(() => undefined), timeoutMs: 30 });
    const started = Date.now();
    await recorder(input);
    assert.ok(Date.now() - started < 500, "returned after the timeout, not after the hung write");
  });

  it("does not leave an unhandled rejection behind when a late write fails after the timeout", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const { recorder } = harness({
        record: () => new Promise((_, reject) => setTimeout(() => reject(new Error("late failure")), 60)),
        timeoutMs: 10,
      });
      await recorder(input);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("logs a short code only, never the error's own text (it can contain addresses and credentials)", async () => {
    const { recorder } = harness({
      record: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED postgres://svc:topsecret@10.0.0.5:5432/app"), { code: "ECONNREFUSED" })), // secret-scan: allow
    });
    await recorder(input);
    const logged = warnings.join("\n");
    assert.doesNotMatch(logged, /topsecret|10\.0\.0\.5|postgres:\/\//);
    assert.match(logged, /ECONNREFUSED|record_skipped/);
  });
});

describe("backing off from a struggling database", () => {
  it("stops attempting writes for a while after a failure, then tries again", async () => {
    const { recorder, calls, advance } = harness({ record: () => Promise.reject(new Error("db down")) });
    await recorder(input);
    await recorder(input);
    await recorder(input);
    assert.equal(calls.length, 1, "later failures inside the pause do not touch the database");
    advance(1_001);
    await recorder(input);
    assert.equal(calls.length, 2, "after the pause it tries again");
  });

  it("pauses longer after repeated failures", async () => {
    const { recorder, calls, advance } = harness({ record: () => Promise.reject(new Error("db down")) });
    await recorder(input);
    advance(1_001);
    await recorder(input);
    advance(1_001);
    await recorder(input);
    assert.equal(calls.length, 2, "the second pause is the longer one");
    advance(10_000);
    await recorder(input);
    assert.equal(calls.length, 3);
  });

  it("a timeout counts as a failure", async () => {
    const { recorder, calls } = harness({ record: () => new Promise(() => undefined), timeoutMs: 10 });
    await recorder(input);
    await recorder(input);
    assert.equal(calls.length, 1);
  });

  it("a success clears the back-off, so one blip is not remembered", async () => {
    let fail = true;
    const { recorder, calls, advance } = harness({ record: async () => (fail ? Promise.reject(new Error("blip")) : undefined) });
    await recorder(input);
    fail = false;
    advance(1_001);
    await recorder(input);
    await recorder(input);
    assert.equal(calls.length, 3, "healthy again: every failure is recorded");
  });
});
