import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPoller } from "../../src/lib/client/poller";
import {
  ApiError,
  backoffDelay,
  createRequester,
  detectCloudflareEdgeError,
  parseRetryAfter,
} from "../../src/lib/client/request";
import { createSingleFlight } from "../../src/lib/client/use-single-flight";
import { takeTokens } from "../../src/lib/token-bucket";

// What Cloudflare actually sends. 1015 and 1020 are HTML pages; 1102 is plain text.
const CF_1015 = `<!DOCTYPE html><html lang="en-US"><head><title>Error 1015 | You are being rate limited</title></head>
<body><div id="cf-wrapper"><div id="cf-error-details" class="p-0"><header class="mx-auto pt-10 lg:pt-6 lg:px-8 w-240 lg:w-full mb-8">
<h1 class="inline-block md:block mr-2 md:mb-2 font-light text-60 md:text-3xl text-black-dark leading-tight">
<span data-translate="error">Error</span> <span>1015</span></h1><span class="inline-block md:block heading-ray-id font-mono text-15 lg:text-sm lg:leading-relaxed">Ray ID: 8a1b2c3d4e5f6a7b</span></header>
<h2 class="text-gray-600 leading-1.3 text-3xl lg:text-2xl font-light">You are being rate limited</h2></div></div></body></html>`;
const CF_1020 = `<!DOCTYPE html><html lang="en-US"><head><title>Access denied | tradecatch.ca used Cloudflare to restrict access</title></head>
<body><div id="cf-wrapper"><div class="cf-error-details"><h1>Access denied</h1><span class="cf-error-code">Error code 1020</span>
<p>You do not have access to tradecatch.ca.</p><p>The site owner may have set restrictions that prevent you from accessing the site.</p></div></div></body></html>`;
const CF_1102 = "error code: 1102";

const html = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=UTF-8", server: "cloudflare", "cf-ray": "8a1b2c3d4e5f6a7b-YYZ", ...headers },
  });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A requester on a virtual clock whose fetch is a script; sleeps are recorded, not waited for. */
function harness(script: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>, random = () => 0.5) {
  let now = 1_700_000_000_000;
  const sleeps: number[] = [];
  const calls: Array<{ url: string; method: string }> = [];
  let next = 0;
  const requester = createRequester({
    now: () => now,
    random,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      const step = script[Math.min(next, script.length - 1)];
      next += 1;
      return step(url, init);
    }) as typeof fetch,
  });
  return { requester, sleeps, calls, advance: (ms: number) => (now += ms) };
}

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates and ignores nonsense", () => {
    assert.equal(parseRetryAfter("30"), 30_000);
    assert.equal(parseRetryAfter(" 1.5 "), 1_500);
    assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:28:30 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT")), 30_000);
    assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 07:30:00 GMT")), 0, "a date in the past means now");
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter("soon"), null);
    assert.equal(parseRetryAfter("999999999"), 3_600_000, "capped at an hour");
  });
});

describe("backoffDelay (exponential, full jitter)", () => {
  it("waits a random time between 0 and base x 2^attempt, capped", () => {
    assert.equal(backoffDelay(0, () => 0), 0);
    assert.equal(backoffDelay(0, () => 0.999), 499);
    assert.equal(backoffDelay(3, () => 0.999), 3_996);
    assert.equal(backoffDelay(20, () => 0.999), 29_970, "capped at 30 s");
    let seed = 7;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const waits = Array.from({ length: 2_000 }, () => backoffDelay(4, random));
    assert.ok(waits.every((w) => w >= 0 && w < 8_000));
    assert.ok(Math.min(...waits) < 200 && Math.max(...waits) > 7_800, "spread across the whole range, not clustered near the maximum");
  });
});

describe("recognising Cloudflare's own answers", () => {
  it("Error 1015 is a rate limit, Error 1020 is a block, error code 1102 is the Worker being out of resources", () => {
    const h = (extra: Record<string, string> = {}) =>
      new Headers({ "content-type": "text/html", server: "cloudflare", ...extra });
    assert.deepEqual(detectCloudflareEdgeError(429, h(), CF_1015), { code: 1015, kind: "rate_limited" });
    assert.deepEqual(detectCloudflareEdgeError(403, h(), CF_1020), { code: 1020, kind: "blocked" });
    assert.deepEqual(detectCloudflareEdgeError(503, new Headers({ "content-type": "text/plain", server: "cloudflare" }), CF_1102), { code: 1102, kind: "unavailable" });
    assert.deepEqual(detectCloudflareEdgeError(522, h(), "<title>Connection timed out</title> Error 522"), { code: 522, kind: "unavailable" });
    assert.deepEqual(detectCloudflareEdgeError(403, new Headers({ "cf-mitigated": "challenge", "content-type": "text/html" }), "<html>Just a moment...</html>"), { code: 0, kind: "blocked" });
  });

  it("never mistakes our own JSON answers, or other servers' pages, for Cloudflare's", () => {
    const jsonHeaders = new Headers({ "content-type": "application/json", server: "cloudflare" });
    assert.equal(detectCloudflareEdgeError(429, jsonHeaders, '{"error":"Too many requests","code":"rate_limited"}'), null);
    assert.equal(detectCloudflareEdgeError(403, jsonHeaders, '{"error":"Cross-site request blocked."}'), null);
    assert.equal(detectCloudflareEdgeError(404, new Headers({ "content-type": "text/html" }), "<h1>Not found</h1>"), null);
    assert.equal(detectCloudflareEdgeError(502, new Headers({ "content-type": "text/html", server: "nginx" }), "<h1>Bad gateway</h1>"), null);
  });
});

describe("requestJson", () => {
  it("returns parsed JSON on success", async () => {
    const { requester } = harness([() => json({ ok: true })]);
    assert.deepEqual(await requester.request("/api/app/me"), { ok: true });
  });

  it("our 429: waits the Retry-After (plus a little jitter), then succeeds", async () => {
    const { requester, sleeps, calls } = harness([
      () => json({ error: "Too many requests", code: "rate_limited", retryAfterSeconds: 2 }, 429, { "retry-after": "2" }),
      () => json({ ok: true }),
    ]);
    assert.deepEqual(await requester.request("/api/app/leads"), { ok: true });
    assert.equal(calls.length, 2);
    assert.ok(sleeps[0] >= 2_000 && sleeps[0] < 2_250, `waited ${sleeps[0]} ms`);
  });

  it("our 429 is retried for a write too, because a refused request never ran", async () => {
    const { requester, calls } = harness([
      () => json({ error: "x" }, 429, { "retry-after": "1" }),
      () => json({ ok: true }),
    ]);
    assert.deepEqual(await requester.request("/api/app/leads", { method: "POST", body: { a: 1 }, retries: 1 }), { ok: true });
    assert.equal(calls.length, 2);
  });

  it("does not sit on a long wait: a Retry-After beyond maxWaitMs is handed to the caller", async () => {
    const { requester, sleeps, calls } = harness([() => json({ error: "x" }, 429, { "retry-after": "120" })]);
    await assert.rejects(
      () => requester.request("/api/app/leads"),
      (error: ApiError) => error.kind === "rate_limited" && error.retryAfterMs === 120_000 && error.source === "app",
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("Cloudflare Error 1015: classified, and the browser stops sending to the whole site for a minute", async () => {
    const { requester, calls, advance } = harness([() => html(CF_1015, 429), () => json({ ok: true })]);
    await assert.rejects(
      () => requester.request("/api/app/overview", { retries: 0 }),
      (error: ApiError) =>
        error.kind === "rate_limited" &&
        error.source === "cloudflare" &&
        error.cloudflareCode === 1015 &&
        error.retryAfterMs === 60_000 &&
        error.retryable,
    );
    // A different route, same site: no request is sent while Cloudflare's limit is in force.
    await assert.rejects(
      () => requester.request("/api/app/leads", { method: "POST", body: {} }),
      (error: ApiError) => error.kind === "rate_limited" && error.details.cooling === true && error.retryAfterMs === 60_000,
    );
    assert.equal(calls.length, 1, "the second call never left the browser");
    advance(60_001);
    assert.deepEqual(await requester.request("/api/app/overview"), { ok: true });
    assert.equal(calls.length, 2);
  });

  it("Cloudflare Error 1015 with a Retry-After header uses it", async () => {
    const { requester } = harness([() => html(CF_1015, 429, { "retry-after": "45" })]);
    await assert.rejects(
      () => requester.request("/api/app/overview", { retries: 0 }),
      (error: ApiError) => error.retryAfterMs === 45_000,
    );
  });

  it("Cloudflare Error 1020: a block, never retried, not retryable", async () => {
    const { requester, calls } = harness([() => html(CF_1020, 403)]);
    await assert.rejects(
      () => requester.request("/api/app/overview"),
      (error: ApiError) =>
        error.kind === "blocked" && error.source === "cloudflare" && error.cloudflareCode === 1020 && !error.retryable,
    );
    assert.equal(calls.length, 1);
  });

  it("our own 403 JSON is 'forbidden', not a Cloudflare block", async () => {
    const { requester } = harness([() => json({ error: "Cross-site request blocked." }, 403)]);
    await assert.rejects(
      () => requester.request("/api/app/leads", { method: "POST", body: {} }),
      (error: ApiError) => error.kind === "forbidden" && error.source === "app",
    );
  });

  it("Error 1102 and 5xx: a GET is retried with jittered backoff, a bare write is not", async () => {
    const get = harness([() => html(CF_1102, 503), () => html(CF_1102, 503), () => json({ ok: true })], () => 0.5);
    assert.deepEqual(await get.requester.request("/api/app/overview"), { ok: true });
    assert.deepEqual(get.sleeps, [250, 500], "half of 500 ms, then half of 1000 ms");

    const post = harness([() => html(CF_1102, 503), () => json({ ok: true })]);
    await assert.rejects(
      () => post.requester.request("/api/app/leads", { method: "POST", body: {}, retries: 2 }),
      (error: ApiError) => error.kind === "unavailable" && error.cloudflareCode === 1102,
    );
    assert.equal(post.calls.length, 1, "it may have run: not repeated");

    const keyed = harness([() => html(CF_1102, 503), () => json({ ok: true })]);
    assert.deepEqual(
      await keyed.requester.request("/api/businesses/o1/appointments", { method: "POST", body: { idempotencyKey: "k" }, idempotent: true, retries: 2 }),
      { ok: true },
    );
    assert.equal(keyed.calls.length, 2, "with an idempotency key the server de-duplicates, so it is repeated");
  });

  it("network failures are 'network'; a GET retries them, a write does not", async () => {
    const down = () => {
      throw new TypeError("Failed to fetch");
    };
    const get = harness([down, () => json({ ok: true })]);
    assert.deepEqual(await get.requester.request("/api/app/overview"), { ok: true });
    const post = harness([down, () => json({ ok: true })]);
    await assert.rejects(
      () => post.requester.request("/api/app/leads", { method: "POST", body: {}, retries: 2 }),
      (error: ApiError) => error.kind === "network" && error.status === 0,
    );
  });

  it("gives up on a hung request after timeoutMs", async () => {
    const { requester } = harness([
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ]);
    await assert.rejects(
      () => requester.request("/api/app/overview", { timeoutMs: 20, retries: 0 }),
      (error: ApiError) => error.kind === "network",
    );
  });

  it("classifies the rest without guessing", async () => {
    const cases: Array<[Response, string]> = [
      [json({ error: "no" }, 401), "unauthorized"],
      [json({ error: "no" }, 400), "client"],
      [json({ error: "no" }, 500), "server"],
      [new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }), "invalid_response"],
    ];
    for (const [response, kind] of cases) {
      const { requester } = harness([() => response.clone()]);
      await assert.rejects(
        () => requester.request("/api/app/x", { retries: 0 }),
        (error: ApiError) => error.kind === kind,
        kind,
      );
    }
    const withBody = harness([() => json({ error: "Invalid", code: "invalid_values" }, 400)]);
    await assert.rejects(
      () => withBody.requester.request("/api/app/x", { method: "POST", body: {} }),
      (error: ApiError) => (error.body as { code?: string }).code === "invalid_values",
    );
  });

  it("shares one in-flight GET between identical callers, but not writes", async () => {
    let release: (r: Response) => void = () => {};
    const { requester, calls } = harness([() => new Promise<Response>((resolve) => (release = resolve))]);
    const callers = Array.from({ length: 5 }, () => requester.request("/api/app/overview"));
    assert.equal(calls.length, 1, "five callers, one request");
    release(json({ n: 1 }));
    assert.deepEqual(await Promise.all(callers), Array(5).fill({ n: 1 }));

    const writes = harness([() => json({ ok: true })]);
    await Promise.all(Array.from({ length: 3 }, () => writes.requester.request("/api/app/leads", { method: "POST", body: {} })));
    assert.equal(writes.calls.length, 3);
  });
});

describe("20-50 rapid requests against a rate-limited server", () => {
  /** A server that really is a token bucket (20 at once, then 1 per 3 s) on the same virtual clock. */
  function limitedServer() {
    let now = 1_700_000_000_000;
    let fullAt: number | null = null;
    const spec = { capacity: 20, refillEveryMs: 3_000 };
    const seen = { served: 0, refused: 0 };
    const requester = createRequester({
      now: () => now,
      random: () => 0.5,
      sleep: async (ms) => {
        now += ms;
      },
      fetch: (async () => {
        const result = takeTokens(spec, fullAt, now);
        fullAt = result.fullAt;
        if (result.decision.allowed) {
          seen.served += 1;
          return json({ ok: true });
        }
        seen.refused += 1;
        const wait = Math.ceil(result.decision.retryAfterMs / 1000);
        return json({ error: "Too many requests", code: "rate_limited", retryAfterSeconds: wait }, 429, { "retry-after": String(wait) });
      }) as typeof fetch,
    });
    return { requester, seen, advance: (ms: number) => (now += ms) };
  }

  it("a browser that fires 50 at once is refused once, then stops sending, then recovers", async () => {
    const { requester, seen, advance } = limitedServer();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        requester.request(`/api/app/item?n=${i}`, { retries: 0 }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const limited = results.filter((r) => r.status === "rejected" && (r.reason as ApiError).kind === "rate_limited");
    // All 50 were already in flight together, so the server saw them all and
    // refused 30. That is the server doing its job.
    assert.equal(ok, 20);
    assert.equal(limited.length, 30);
    assert.equal(seen.served, 20);

    // The next 50 do not even leave the browser: the 429 is still in force.
    const before = seen.served + seen.refused;
    const again = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => requester.request(`/api/app/item?n=${i}`, { retries: 0 })));
    assert.ok(again.every((r) => r.status === "rejected" && (r.reason as ApiError).details.cooling === true));
    assert.equal(seen.served + seen.refused, before, "no further requests reached the server");

    // After the advertised wait, the next request is served.
    advance(3_001);
    assert.deepEqual(await requester.request("/api/app/item?n=1", { retries: 0 }), { ok: true });
  });

  it("fifty sequential requests: the 21st is refused and the other 29 never go out", async () => {
    const { requester, seen } = limitedServer();
    const results = [];
    for (let i = 0; i < 50; i += 1) {
      results.push(await requester.request("/api/app/item", { method: "POST", body: { i }, retries: 0 }).then(() => "ok", (e: ApiError) => (e.details.cooling ? "held back" : e.kind)));
    }
    assert.equal(results.filter((r) => r === "ok").length, 20);
    assert.equal(results.filter((r) => r === "rate_limited").length, 1, "one real refusal");
    assert.equal(results.filter((r) => r === "held back").length, 29);
    assert.equal(seen.served + seen.refused, 21);
  });
});

describe("createSingleFlight (rapid clicking)", () => {
  it("runs a task once however many times it is triggered while running", async () => {
    const flight = createSingleFlight();
    let runs = 0;
    let release: () => void = () => {};
    const task = () =>
      new Promise<string>((resolve) => {
        runs += 1;
        release = () => resolve("done");
      });
    const clicks = Array.from({ length: 25 }, () => flight.run(task));
    assert.equal(runs, 1);
    assert.equal(flight.busy, true);
    release();
    const results = await Promise.all(clicks);
    assert.equal(results.filter((r) => r === "done").length, 1);
    assert.equal(results.filter((r) => r === undefined).length, 24);
    assert.equal(flight.busy, false);
    // Usable again afterwards.
    const again = flight.run(async () => "second");
    assert.equal(await again, "second");
  });

  it("releases the lock when the task fails", async () => {
    const flight = createSingleFlight();
    await assert.rejects(() => flight.run(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await flight.run(async () => "ok"), "ok");
  });
});

describe("createPoller", () => {
  type Timer = { at: number; fn: () => void; id: number };
  function pollerHarness(options: { intervalMs: number; minGapMs?: number }, outcomes: Array<() => Promise<void>>) {
    let now = 0;
    let nextId = 1;
    let timers: Timer[] = [];
    let hidden = false;
    let offline = false;
    let wake: (() => void) | null = null;
    let runs = 0;
    const starts: number[] = [];
    let aborted = 0;
    const poller = createPoller(
      async (signal) => {
        runs += 1;
        starts.push(now);
        signal.addEventListener("abort", () => (aborted += 1));
        await outcomes[Math.min(runs - 1, outcomes.length - 1)]();
      },
      options,
      {
        random: () => 0.5, // no jitter: exactly the interval
        now: () => now,
        setTimeout: (fn, ms) => {
          const id = nextId++;
          timers.push({ at: now + ms, fn, id });
          return id;
        },
        clearTimeout: (handle) => {
          timers = timers.filter((t) => t.id !== handle);
        },
        isHidden: () => hidden,
        isOffline: () => offline,
        onWake: (cb) => {
          wake = cb;
          return () => {
            wake = null;
          };
        },
      },
    );
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    /** Advance virtual time, firing timers in order and letting each run finish. */
    async function advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        now = due.at;
        due.fn();
        await flush();
      }
      now = end;
    }
    return {
      poller,
      advance,
      flush,
      get runs() { return runs; },
      starts,
      get aborted() { return aborted; },
      get pending() { return timers.length; },
      hide: (value: boolean) => { hidden = value; if (!value) wake?.(); },
      setOffline: (value: boolean) => { offline = value; },
    };
  }

  const ok = async () => {};
  const rateLimited = (retryAfterMs: number) => async () => {
    throw new ApiError("rate_limited", 429, "slow down", { retryAfterMs });
  };
  const unavailable = async () => {
    throw new ApiError("unavailable", 503, "down");
  };

  it("runs once per interval and never more often", async () => {
    const h = pollerHarness({ intervalMs: 20_000 }, [ok]);
    h.poller.start();
    await h.advance(100_000);
    assert.equal(h.runs, 5);
    assert.deepEqual(h.starts, [20_000, 40_000, 60_000, 80_000, 100_000]);
    h.poller.stop();
  });

  it("backs off exponentially while the server fails, and returns to the beat after one success", async () => {
    const h = pollerHarness({ intervalMs: 10_000 }, [unavailable, unavailable, unavailable, ok, ok]);
    h.poller.start();
    await h.advance(10 * 60_000);
    const gaps = h.starts.slice(1).map((s, i) => s - h.starts[i]);
    // After failure n the wait is 0.75 x interval x 2^n (equal jitter at
    // random = 0.5): 15 s, 30 s, 60 s, and the first success returns it to 10 s.
    assert.deepEqual(gaps.slice(0, 4), [15_000, 30_000, 60_000, 10_000]);
    h.poller.stop();
  });

  it("caps the backoff", async () => {
    const h = pollerHarness({ intervalMs: 20_000 }, [unavailable]);
    h.poller.start();
    await h.advance(2 * 60 * 60_000);
    const gaps = h.starts.slice(1).map((s, i) => s - h.starts[i]);
    assert.ok(Math.max(...gaps) <= 5 * 60_000, `longest wait ${Math.max(...gaps)}`);
    assert.ok(h.runs < 40, `${h.runs} runs in two hours while the server is down`);
    h.poller.stop();
  });

  it("waits at least as long as Retry-After after a 429", async () => {
    const h = pollerHarness({ intervalMs: 20_000 }, [rateLimited(120_000), ok]);
    h.poller.start({ immediate: true });
    await h.flush();
    assert.equal(h.runs, 1);
    await h.advance(119_000);
    assert.equal(h.runs, 1, "still waiting");
    await h.advance(2_000);
    assert.equal(h.runs, 2);
    h.poller.stop();
  });

  it("does not overlap: a slow run delays the next one, and poke() during it does nothing", async () => {
    let release: () => void = () => {};
    const slow = () => new Promise<void>((resolve) => (release = resolve));
    const h = pollerHarness({ intervalMs: 10_000, minGapMs: 0 }, [slow, ok]);
    h.poller.start({ immediate: true });
    await h.flush();
    assert.equal(h.runs, 1);
    h.poller.poke();
    h.poller.poke();
    await h.advance(60_000);
    assert.equal(h.runs, 1, "nothing starts while the first is still running");
    release();
    await h.flush();
    await h.advance(10_000);
    assert.equal(h.runs, 2);
    h.poller.stop();
  });

  it("pauses in a hidden tab, resumes when it is shown, and pauses offline", async () => {
    const h = pollerHarness({ intervalMs: 10_000, minGapMs: 0 }, [ok]);
    h.poller.start();
    h.hide(true);
    await h.advance(120_000);
    assert.equal(h.runs, 0, "a hidden tab asks for nothing");
    h.hide(false);
    await h.flush();
    assert.equal(h.runs, 1, "one catch-up run when it comes back");
    h.poller.stop();

    const offline = pollerHarness({ intervalMs: 10_000 }, [ok]);
    offline.setOffline(true);
    offline.poller.start();
    await offline.advance(60_000);
    assert.equal(offline.runs, 0);
    offline.poller.stop();
  });

  it("stops for good on a 401, and stop() aborts a run in progress", async () => {
    const signedOut = pollerHarness({ intervalMs: 10_000 }, [async () => { throw new ApiError("unauthorized", 401, "no"); }]);
    signedOut.poller.start({ immediate: true });
    await signedOut.flush();
    await signedOut.advance(10 * 60_000);
    assert.equal(signedOut.runs, 1, "no polling after the session ended");

    const never = () => new Promise<void>(() => {});
    const h = pollerHarness({ intervalMs: 10_000 }, [never]);
    h.poller.start({ immediate: true });
    await h.flush();
    h.poller.stop();
    assert.equal(h.aborted, 1);
    assert.equal(h.pending, 0, "no timer left behind");
  });
});
