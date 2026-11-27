/**
 * KAN-28 the Worker-side request recorder. worker.ts cannot be imported in a
 * unit test (it needs the generated OpenNext bundle), so everything it does
 * lives in this module and the entry point is only glue.
 *
 * The property that matters most is MON-16: recording can fail in any way and
 * the customer's response is still returned, unchanged and on time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createObserver, type Observer } from "../../src/product/reliability/observations";
import { createIngestSink, observeRequest } from "../../src/product/reliability/worker-observer";
import type { BucketDelta } from "../../src/product/reliability/types";

const T0 = Date.parse("2026-11-20T15:00:10.000Z");

function setup(opts: { observer?: Observer; flush?: () => Promise<unknown>; realFlush?: boolean } = {}) {
  let clock = T0;
  const observer = opts.observer ?? createObserver({ now: () => clock, flushEveryMs: 30_000 });
  const scheduled: Promise<unknown>[] = [];
  let flushes = 0;
  const run = (path: string, handle: () => Promise<Response>, init: { schedule?: (p: Promise<unknown>) => void } = {}) =>
    observeRequest({
      observer,
      request: new Request(`https://example.test${path}`),
      handle,
      now: () => clock,
      schedule: init.schedule ?? ((work) => void scheduled.push(work)),
      // By default the scheduled flush only counts itself, so tests can still
      // read what was recorded. realFlush drains the observer like production.
      flush:
        opts.flush ??
        (async () => {
          flushes += 1;
          if (opts.realFlush) await observer.flush(async () => undefined);
        }),
    });
  return { observer, run, scheduled, flushes: () => flushes, advance: (ms: number) => void (clock += ms) };
}

const drain = async (observer: Observer) => {
  let rows: BucketDelta[] = [];
  await observer.flush(async (sent) => void (rows = sent), true);
  return rows;
};

describe("observing a request", () => {
  it("returns the very same response, untouched", async () => {
    const { run } = setup();
    const response = new Response("hello", { status: 201, headers: { "x-test": "1" } });
    const result = await run("/api/thing", async () => response);
    assert.equal(result, response);
    assert.equal(result.status, 201);
    assert.equal(await result.text(), "hello");
  });

  it("counts each response by status class and traffic scope, and ignores static assets", async () => {
    const { run, observer } = setup();
    for (const [path, status] of [
      ["/api/a", 200],
      ["/api/a", 500],
      ["/api/b", 403],
      ["/api/b", 429],
      ["/en", 200],
      ["/_next/static/chunk.js", 200],
      ["/favicon.ico", 200],
    ] as [string, number][])
      await run(path, async () => new Response("", { status }));
    const rows = await drain(observer);
    const api = rows.find((row) => row.scope === "api")!;
    const page = rows.find((row) => row.scope === "page")!;
    assert.deepEqual([api.total, api.s2xx, api.s5xx, api.s403, api.s429], [4, 1, 1, 1, 1]);
    assert.deepEqual([page.total, page.s2xx], [1, 1]);
  });

  it("when the handler crashes: the same error is thrown to the platform and counted as a server error", async () => {
    const { run, observer } = setup();
    const crash = new Error("worker exploded");
    await assert.rejects(() => run("/api/x", async () => Promise.reject(crash)), (error) => error === crash);
    const [row] = await drain(observer);
    assert.equal(row.s5xx, 1);
  });
});

describe("MON-16 recording can fail without affecting the customer", () => {
  it("a recorder that throws on every call changes nothing", async () => {
    const broken = {
      record: () => {
        throw new Error("record broke");
      },
      due: () => {
        throw new Error("due broke");
      },
      flush: async () => {
        throw new Error("flush broke");
      },
      pending: () => 0,
    } as unknown as Observer;
    const { run } = setup({ observer: broken });
    const response = new Response("ok");
    assert.equal(await run("/api/x", async () => response), response);
  });

  it("does not wait for the flush before answering", async () => {
    const { run } = setup({ flush: () => new Promise(() => undefined) });
    const started = Date.now();
    await run("/api/x", async () => new Response("ok"));
    assert.ok(Date.now() - started < 500);
  });

  it("a failing flush, or a scheduler that throws, is absorbed", async () => {
    const failing = setup({ flush: () => Promise.reject(new Error("db down")) });
    assert.equal((await failing.run("/api/x", async () => new Response("ok"))).status, 200);
    await Promise.allSettled(failing.scheduled);
    const throwing = setup();
    const response = await throwing.run("/api/x", async () => new Response("ok"), {
      schedule: () => {
        throw new Error("waitUntil rejected");
      },
    });
    assert.equal(response.status, 200);
  });

  it("an unhandled rejection never escapes the scheduled flush", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const { run, scheduled } = setup({ flush: () => Promise.reject(new Error("db down")) });
      await run("/api/x", async () => new Response("ok"));
      await Promise.allSettled(scheduled);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});

describe("when the counters are written", () => {
  it("schedules a flush after the first response, then not again until the interval has passed", async () => {
    const { run, scheduled, flushes, advance } = setup({ realFlush: true });
    await run("/api/x", async () => new Response("ok"));
    await Promise.all(scheduled);
    assert.equal(flushes(), 1);
    await run("/api/x", async () => new Response("ok"));
    await run("/api/x", async () => new Response("ok"));
    assert.equal(scheduled.length, 1, "within the interval: nothing new is scheduled");
    advance(31_000);
    await run("/api/x", async () => new Response("ok"));
    assert.equal(scheduled.length, 2);
  });

  it("schedules nothing when nothing was counted", async () => {
    const { run, scheduled } = setup();
    await run("/_next/static/a.js", async () => new Response("ok"));
    assert.equal(scheduled.length, 0);
  });
});

describe("the sink that carries counters to the database", () => {
  const row: BucketDelta = {
    at: "2026-11-20T15:00:00.000Z",
    scope: "api",
    total: 2,
    s2xx: 2,
    s3xx: 0,
    s401: 0,
    s403: 0,
    s429: 0,
    s4xxOther: 0,
    s5xx: 0,
    lat: [2, 0, 0, 0, 0, 0, 0],
  };

  it("posts the rows, with the monitoring secret, to the internal ingest route", async () => {
    let seen: Request | undefined;
    const sink = createIngestSink({
      origin: "https://example.test",
      secret: "s3cret",
      fetchInternal: async (request) => {
        seen = request;
        return Response.json({ ok: true }, { status: 202 });
      },
    });
    await sink([row]);
    assert.equal(seen?.method, "POST");
    assert.equal(new URL(seen!.url).pathname, "/api/monitoring/ingest");
    assert.equal(seen?.headers.get("authorization"), "Bearer s3cret");
    assert.deepEqual(await seen?.json(), { rows: [row] });
  });

  it("fails (so the observer backs off) on a non-success answer, and without a secret never calls out", async () => {
    const refused = createIngestSink({ origin: "https://example.test", secret: "s", fetchInternal: async () => new Response("", { status: 503 }) });
    await assert.rejects(() => refused([row]));
    let calls = 0;
    const noSecret = createIngestSink({
      origin: "https://example.test",
      secret: "  ",
      fetchInternal: async () => {
        calls += 1;
        return new Response("", { status: 202 });
      },
    });
    await assert.rejects(() => noSecret([row]));
    assert.equal(calls, 0);
  });
});

describe("the Worker entry stays small", () => {
  it("imports no database, rule or incident code at runtime (the Worker bundle is memory-limited)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of ["observations.ts", "worker-observer.ts"]) {
      const text = readFileSync(join(process.cwd(), "src", "product", "reliability", file), "utf8");
      const runtimeImports = [...text.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
      assert.deepEqual(
        runtimeImports.filter((source) => source !== "./observations"),
        [],
        `${file} must only import ./observations at runtime`,
      );
    }
  });
});
