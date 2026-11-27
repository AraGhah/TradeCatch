import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGuardedHandler,
  createSingleFlight,
} from "../../src/lib/client/use-single-flight";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

describe("createGuardedHandler (LOAD-02: fifty clicks, one operation)", () => {
  it("runs the handler once for fifty calls in the same tick", async () => {
    const g = gate();
    let runs = 0;
    const guarded = createGuardedHandler(createSingleFlight(), () => async () => {
      runs += 1;
      await g.promise;
      return "saved";
    });
    const calls = Array.from({ length: 50 }, () => guarded());
    assert.equal(runs, 1);
    g.release();
    const results = await Promise.all(calls);
    assert.equal(results.filter((r) => r === "saved").length, 1);
    assert.equal(results.filter((r) => r === undefined).length, 49);
  });

  it("accepts a new call once the first finished, even when it threw", async () => {
    let runs = 0;
    const guarded = createGuardedHandler(createSingleFlight(), () => async () => {
      runs += 1;
      throw new Error("boom");
    });
    await assert.rejects(guarded());
    await assert.rejects(guarded());
    assert.equal(runs, 2, "a failure must not leave the handler locked");
  });

  it("passes arguments through", async () => {
    const guarded = createGuardedHandler(createSingleFlight(), () => async (a: number, b: number) => a + b);
    assert.equal(await guarded(2, 3), 5);
  });

  it("always calls the latest handler", async () => {
    let current = async () => "first";
    const guarded = createGuardedHandler(createSingleFlight(), () => current);
    assert.equal(await guarded(), "first");
    current = async () => "second";
    assert.equal(await guarded(), "second");
  });

  it("stops the browser's own submission for a submit event it drops", async () => {
    const g = gate();
    const guarded = createGuardedHandler(createSingleFlight(), () => async (event: unknown) => {
      void event;
      await g.promise;
    });
    const events = Array.from({ length: 3 }, () => ({
      type: "submit",
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    }));
    const calls = events.map((event) => guarded(event));
    // The handler would call preventDefault itself for the first; the two it never saw must still be stopped.
    assert.equal(events[1].prevented, true);
    assert.equal(events[2].prevented, true);
    g.release();
    await Promise.all(calls);
  });

  it("leaves a click's default action alone", async () => {
    const g = gate();
    const guarded = createGuardedHandler(createSingleFlight(), () => async (event: unknown) => {
      void event;
      await g.promise;
    });
    const click ={ type: "click", prevented: false, preventDefault() { this.prevented = true; } };
    const calls = [guarded({ type: "click", preventDefault() {} }), guarded(click)];
    assert.equal(click.prevented, false);
    g.release();
    await Promise.all(calls);
  });
});
