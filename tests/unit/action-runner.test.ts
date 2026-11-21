import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../../src/lib/client/request";
import { RequestTimeoutError, timedFetch } from "../../src/lib/client/timed-fetch";
import {
  ActionTimeoutError,
  classifyFailure,
  createActionRunner,
  failureFromStatus,
} from "../../src/lib/client/use-action";

/** A task that settles when told to; never on its own. */
function gate<T>() {
  let release!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

describe("createActionRunner: one at a time (LOAD-02, LOAD-07, LOAD-08)", () => {
  it("starts one task for fifty calls made in the same tick", async () => {
    const runner = createActionRunner();
    const g = gate<string>();
    let started = 0;
    const calls = Array.from({ length: 50 }, () =>
      runner.run(() => {
        started += 1;
        return g.promise;
      }),
    );
    // No await between the calls above: this is what fifty fast clicks look like.
    assert.equal(started, 1);
    g.release("done");
    const outcomes = await Promise.all(calls);
    assert.equal(outcomes.filter((o) => o.status === "ok").length, 1);
    assert.equal(outcomes.filter((o) => o.status === "dropped").length, 49);
    assert.equal(runner.busy, false);
  });

  it("runs again once the first has finished", async () => {
    const runner = createActionRunner();
    assert.deepEqual(await runner.run(async () => 1), { status: "ok", value: 1 });
    assert.deepEqual(await runner.run(async () => 2), { status: "ok", value: 2 });
  });
});

describe("createActionRunner: it always ends (LOAD-05, LOAD-15)", () => {
  it("cuts off a task that never settles and says it timed out", async () => {
    const runner = createActionRunner();
    const outcome = await runner.run(() => new Promise<never>(() => undefined), {
      timeoutMs: 20,
    });
    assert.equal(outcome.status, "failed");
    if (outcome.status === "failed") assert.equal(outcome.failure.kind, "timeout");
    assert.equal(runner.busy, false, "the lock must be released, or the button stays disabled forever");
  });

  it("aborts the signal it handed the task when time runs out", async () => {
    const runner = createActionRunner();
    let aborted = false;
    await runner.run(
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
      { timeoutMs: 20 },
    );
    assert.equal(aborted, true);
  });

  it("ignores a late answer from a task that already timed out", async () => {
    const runner = createActionRunner();
    const g = gate<string>();
    const outcome = await runner.run(() => g.promise, { timeoutMs: 20 });
    g.release("too late");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(outcome.status, "failed");
  });

  it("keeps working after repeated failures: no permanently disabled button", async () => {
    const runner = createActionRunner();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const outcome = await runner.run(async () => {
        throw new TypeError("Failed to fetch");
      });
      assert.equal(outcome.status, "failed");
      assert.equal(runner.busy, false, `attempt ${attempt + 1} left the lock held`);
    }
    assert.deepEqual(await runner.run(async () => "back"), { status: "ok", value: "back" });
  });

  it("a task that rejects clears the lock too", async () => {
    const runner = createActionRunner();
    const g = gate<string>();
    const pending = runner.run(() => g.promise);
    g.fail(new Error("boom"));
    const outcome = await pending;
    assert.equal(outcome.status, "failed");
    assert.equal(runner.busy, false);
  });
});

describe("createActionRunner: leaving the screen (LOAD-12)", () => {
  it("abort() reports cancelled, not a failure, and frees the lock", async () => {
    const runner = createActionRunner();
    const g = gate<string>();
    let signal!: AbortSignal;
    const pending = runner.run((s) => {
      signal = s;
      return g.promise;
    });
    runner.abort();
    assert.equal(signal.aborted, true);
    g.fail(new DOMException("aborted", "AbortError"));
    assert.deepEqual(await pending, { status: "cancelled" });
    assert.equal(runner.busy, false);
  });

  it("a task that ignores its signal still reports cancelled once it answers", async () => {
    const runner = createActionRunner();
    const g = gate<string>();
    const pending = runner.run(() => g.promise);
    runner.abort();
    g.release("late value for a screen that is gone");
    assert.deepEqual(await pending, { status: "cancelled" });
  });

  it("abort() with nothing running changes nothing", async () => {
    const runner = createActionRunner();
    runner.abort();
    assert.deepEqual(await runner.run(async () => "ok"), { status: "ok", value: "ok" });
  });
});

describe("classifyFailure", () => {
  it("names a timeout, and for a write says the outcome is unknown", () => {
    const read = classifyFailure(new ActionTimeoutError(30_000));
    assert.equal(read.kind, "timeout");
    assert.equal(read.outcomeUnknown, false);
    assert.equal(read.retrySafe, true);

    const write = classifyFailure(new RequestTimeoutError(30_000), { write: true });
    assert.equal(write.kind, "timeout");
    assert.equal(write.outcomeUnknown, true);
    assert.equal(write.retrySafe, false, "repeating a write that may have run could do it twice");
  });

  it("a write the server de-duplicates is safe to repeat after an unknown outcome", () => {
    const failure = classifyFailure(new RequestTimeoutError(30_000), { write: true, idempotent: true });
    assert.equal(failure.outcomeUnknown, true);
    assert.equal(failure.retrySafe, true);
  });

  it("a dropped connection on a write is an unknown outcome; on a read it is not", () => {
    assert.equal(classifyFailure(new TypeError("Failed to fetch"), { write: true }).outcomeUnknown, true);
    assert.equal(classifyFailure(new TypeError("Failed to fetch")).outcomeUnknown, false);
  });

  it("a refused request (429) never ran, so repeating it is safe even for a write", () => {
    const failure = classifyFailure(
      new ApiError("rate_limited", 429, "slow down", { retryAfterMs: 7_000 }),
      { write: true },
    );
    assert.equal(failure.kind, "rate_limited");
    assert.equal(failure.retryAfterMs, 7_000);
    assert.equal(failure.outcomeUnknown, false);
    assert.equal(failure.retrySafe, true);
  });

  it("maps the other ApiError kinds", () => {
    assert.equal(classifyFailure(new ApiError("blocked", 403, "x")).kind, "blocked");
    assert.equal(classifyFailure(new ApiError("blocked", 403, "x")).retrySafe, false);
    assert.equal(classifyFailure(new ApiError("unavailable", 503, "x")).kind, "unavailable");
    assert.equal(classifyFailure(new ApiError("unauthorized", 401, "x")).kind, "unauthorized");
    assert.equal(classifyFailure(new ApiError("forbidden", 403, "x")).kind, "forbidden");
    assert.equal(classifyFailure(new ApiError("server", 500, "x")).kind, "server");
    assert.equal(classifyFailure(new ApiError("invalid_response", 200, "x")).kind, "server");
    assert.equal(classifyFailure(new ApiError("invalid_response", 200, "x")).outcomeUnknown, false, "a read is just retried");
    assert.equal(classifyFailure(new ApiError("client", 409, "x")).kind, "conflict");
    assert.equal(classifyFailure(new ApiError("client", 422, "x")).kind, "invalid");
    assert.equal(classifyFailure(new ApiError("client", 422, "x")).retrySafe, false);
  });

  it("a write answered with 2xx and an unreadable body is an unknown outcome, retry-safe only if idempotent", () => {
    const unreadable = new ApiError("invalid_response", 200, "x");
    const plain = classifyFailure(unreadable, { write: true });
    assert.equal(plain.kind, "server");
    assert.equal(plain.outcomeUnknown, true);
    assert.equal(plain.retrySafe, false, "repeating a non-idempotent write could do it twice");
    const safe = classifyFailure(unreadable, { write: true, idempotent: true });
    assert.equal(safe.outcomeUnknown, true);
    assert.equal(safe.retrySafe, true);
    // A non-2xx unreadable answer is an ordinary failure: the server said no.
    const refused = classifyFailure(new ApiError("invalid_response", 502, "x"), { write: true });
    assert.equal(refused.outcomeUnknown, false);
  });

  it("anything else is unknown, never a crash", () => {
    assert.equal(classifyFailure("a string").kind, "unknown");
    assert.equal(classifyFailure(null).kind, "unknown");
    assert.equal(classifyFailure(undefined).kind, "unknown");
  });
});

describe("failureFromStatus", () => {
  it("reads statuses the way the screens need them", () => {
    assert.equal(failureFromStatus(401).kind, "unauthorized");
    assert.equal(failureFromStatus(403).kind, "forbidden");
    assert.equal(failureFromStatus(409).kind, "conflict");
    assert.equal(failureFromStatus(422).kind, "invalid");
    assert.equal(failureFromStatus(429, { retryAfterMs: 3_000 }).retryAfterMs, 3_000);
    assert.equal(failureFromStatus(503).kind, "unavailable");
    assert.equal(failureFromStatus(504).kind, "timeout");
    assert.equal(failureFromStatus(500).kind, "server");
  });
});

describe("timedFetch", () => {
  it("returns the response and does not leave a timer behind", async () => {
    const response = await timedFetch("/x", { timeoutMs: 10_000 }, (async () => new Response("ok")) as typeof fetch);
    assert.equal(await response.text(), "ok");
    // If a 10 s timer were left running, the test process would not exit until it fired.
  });

  it("rejects with a TimeoutError when nothing answers, and aborts the request", async () => {
    let aborted = false;
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch;
    await assert.rejects(timedFetch("/x", { timeoutMs: 20 }, hang), (error: Error) => {
      assert.ok(error instanceof RequestTimeoutError);
      assert.equal(error.name, "TimeoutError");
      return true;
    });
    assert.equal(aborted, true);
  });

  it("passes the caller's own abort through as an abort, not a timeout", async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;
    const controller = new AbortController();
    const pending = timedFetch("/x", { timeoutMs: 10_000, signal: controller.signal }, hang);
    controller.abort();
    await assert.rejects(pending, (error: Error) => error.name === "AbortError");
  });

  it("honours a signal that was already aborted", async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
      })) as typeof fetch;
    await assert.rejects(
      timedFetch("/x", { signal: AbortSignal.abort() }, hang),
      (error: Error) => error.name === "AbortError",
    );
  });

  it("passes real network errors through unchanged", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(timedFetch("/x", {}, down), TypeError);
  });

  it("passes the method, headers and body to fetch untouched", async () => {
    let seen: RequestInit | undefined;
    await timedFetch(
      "/x",
      { method: "POST", headers: { a: "b" }, body: "{}", timeoutMs: 1_000 },
      (async (_: unknown, init?: RequestInit) => {
        seen = init;
        return new Response("ok");
      }) as typeof fetch,
    );
    assert.equal(seen?.method, "POST");
    assert.deepEqual(seen?.headers, { a: "b" });
    assert.equal(seen?.body, "{}");
  });
});
