/**
 * KAN-28 the per-minute monitor run, end to end over the real incident engine,
 * the real alert outbox and the memory store. Probes, signal collection and
 * the email provider are the only things stubbed.
 *
 * MON-01 website down, MON-02/03 API traffic, MON-04/05 receptionist signals,
 * MON-09 database unavailable (both while the database can still store the
 * incident and while it cannot), MON-10 grouping across runs, MON-11 recovery,
 * MON-16 monitoring failures never propagate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AlertPayload, deliverDueAlerts } from "../../src/product/reliability/alerts";
import { assertAlertSafe } from "../../src/product/reliability/sanitize";
import { probeWebsite } from "../../src/product/reliability/collectors";
import { incidentFingerprint } from "../../src/product/reliability/fingerprint";
import { createIncidentEngine } from "../../src/product/reliability/incidents";
import {
  DATABASE_UNAVAILABLE_FINGERPRINT,
  emptySignals,
  type Signals,
} from "../../src/product/reliability/rules";
import { createMemoryReliabilityStore, type ReliabilityStore } from "../../src/product/reliability/store";
import { DEFAULT_THRESHOLDS as T } from "../../src/product/reliability/thresholds";
import { incidentState, type BucketDelta, type ProbeRecord } from "../../src/product/reliability/types";
import { runMonitor, type MonitorRun } from "../../src/product/reliability/watch";

const MIN = 60_000;
const START = Date.parse("2026-11-20T15:00:00.000Z");

type World = {
  down: Set<string>;
  database: "ok" | "down" | "slow";
  storeDown: boolean;
  /** What every store call rejects with while storeDown (default: an uncoded error quoting a URL). */
  storeError?: Error;
  /** The failure code the database probe reports while down. */
  probeCode?: string;
  signals: Signals;
  degraded: string[];
  websiteThrows: boolean;
  collectThrows: boolean;
  deliverThrows: boolean;
};

function harness(
  opts: { emergency?: boolean; noDatabase?: boolean; noSignals?: boolean; databaseUnconfigured?: boolean } = {},
) {
  const real = createMemoryReliabilityStore();
  let clock = START;
  const world: World = {
    down: new Set(),
    database: "ok",
    storeDown: false,
    signals: emptySignals(),
    degraded: [],
    websiteThrows: false,
    collectThrows: false,
    deliverThrows: false,
  };
  // The same store, but every call fails while the database is "down".
  const store = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        world.storeDown
          ? Promise.reject(
              world.storeError ??
                new Error("connection refused: postgres://user:hunter2@db.internal:5432/app"), // secret-scan: allow
            )
          : value.apply(target, args);
    },
  }) as ReliabilityStore;
  const now = () => new Date(clock);
  const engine = createIncidentEngine({ store, thresholds: T, now });
  const sent: AlertPayload[] = [];
  const emergency: AlertPayload[] = [];
  const pruneCalls: string[] = [];
  const originalPrune = real.prune.bind(real);
  real.prune = async (at, retention) => {
    pruneCalls.push(at);
    return originalPrune(at, retention);
  };

  const run = () =>
    runMonitor({
      store,
      engine,
      thresholds: T,
      now,
      siteUrl: "https://example.test",
      deliverAlerts: async () => {
        if (world.deliverThrows) throw new Error("outbox exploded");
        return deliverDueAlerts({
          store,
          notify: async (payload) => {
            sent.push(payload);
          },
          now,
          thresholds: T,
          siteUrl: "https://example.test",
        });
      },
      checkWebsite: async () => {
        if (world.websiteThrows) throw new Error("dns failure");
        return ["page", "api"].map<ProbeRecord>((target) => ({
          at: now().toISOString(),
          target,
          ok: !world.down.has(target),
          statusCode: world.down.has(target) ? 503 : 200,
          durationMs: 120,
        }));
      },
      checkDatabase: opts.noDatabase
        ? undefined
        : async () =>
            world.database === "down"
              ? {
                  ok: false,
                  readOk: false,
                  writeOk: false,
                  durationMs: T.database.probeTimeoutMs,
                  failureCode: world.probeCode,
                }
              : { ok: true, readOk: true, writeOk: true, durationMs: world.database === "slow" ? T.database.slowMs + 400 : 15 },
      collectSignals: opts.noSignals ? undefined : async () => {
        if (world.collectThrows) throw new Error("query exploded");
        return { signals: world.signals, degraded: world.degraded };
      },
      emergencyNotify:
        opts.emergency === false
          ? undefined
          : async (payload) => {
              emergency.push(payload);
            },
      databaseUnconfigured: opts.databaseUnconfigured,
    });
  async function tick(minutes = 1): Promise<MonitorRun> {
    clock += minutes * MIN;
    return run();
  }
  const incidents = () => real.listIncidents();
  const bucket = (minutesAgo: number, over: Partial<BucketDelta> = {}): BucketDelta => ({
    at: new Date(clock - minutesAgo * MIN).toISOString().replace(/:\d\d\.\d+Z$/, ":00.000Z"),
    scope: "api",
    total: 0,
    s2xx: 0,
    s3xx: 0,
    s401: 0,
    s403: 0,
    s429: 0,
    s4xxOther: 0,
    s5xx: 0,
    lat: [0, 0, 0, 0, 0, 0, 0],
    ...over,
  });
  return { real, store, world, tick, sent, emergency, incidents, pruneCalls, bucket, now, run };
}

describe("MON-01 website availability", () => {
  it("does not alert on one or two failed checks, then opens ONE critical incident and emails once", async () => {
    const h = harness();
    await h.tick();
    h.world.down.add("page");
    await h.tick();
    await h.tick();
    assert.equal((await h.incidents()).length, 0, "two failures in a row are not an outage");
    await h.tick();
    const [incident, ...rest] = await h.incidents();
    assert.equal(rest.length, 0);
    assert.equal(incident.fingerprint, "website:unavailable:page");
    assert.equal(incident.priority, "critical");
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].subject, /^\[TradeCatch CRITICAL\]/);
    assert.equal(h.sent[0].kind, "opened");
  });

  it("MON-10/11: keeps counting one incident while it stays down, then resolves it and says so", async () => {
    const h = harness();
    h.world.down.add("page");
    for (let i = 0; i < 8; i += 1) await h.tick();
    assert.equal((await h.incidents()).length, 1, "grouped into one incident");
    assert.equal(h.sent.length, 1, "no second email while it is down");
    assert.ok(((await h.incidents())[0].occurrenceCount ?? 0) >= 2);

    h.world.down.clear();
    for (let i = 0; i < 6; i += 1) await h.tick();
    const [incident] = await h.incidents();
    assert.equal(incidentState(incident.status), "resolved");
    assert.deepEqual(h.sent.map((p) => p.kind), ["opened", "recovered"]);
    assert.match(h.sent[1].subject, /^\[TradeCatch RESOLVED\]/);
  });

  it("a failing public API check is its own incident, separate from the page", async () => {
    const h = harness();
    h.world.down.add("api");
    for (let i = 0; i < 3; i += 1) await h.tick();
    assert.deepEqual((await h.incidents()).map((i) => i.fingerprint), ["website:unavailable:api"]);
  });
});

describe("MON-09 database unavailable", () => {
  it("when the database can still store it: one critical incident, one alert, and it resolves on recovery", async () => {
    const h = harness();
    await h.tick();
    h.world.database = "down";
    await h.tick();
    const [incident] = await h.incidents();
    assert.equal(incident.fingerprint, DATABASE_UNAVAILABLE_FINGERPRINT);
    assert.equal(incident.priority, "critical");
    assert.equal(h.emergency.length, 0, "the normal outbox handles it");
    assert.equal(h.sent.length, 1);
    await h.tick();
    assert.equal((await h.incidents()).length, 1);
    assert.equal(h.sent.length, 1);

    h.world.database = "ok";
    for (let i = 0; i < 7; i += 1) await h.tick();
    assert.equal(incidentState((await h.incidents())[0].status), "resolved");
    assert.deepEqual(h.sent.map((p) => p.kind), ["opened", "recovered"]);
  });

  it("shares its fingerprint with the 15-minute health check, so the two can never open two incidents", () => {
    assert.equal(DATABASE_UNAVAILABLE_FINGERPRINT, incidentFingerprint({ service: "health:database" }));
  });

  it("when the database cannot store anything: emails administrators directly, without leaking the error", async () => {
    const h = harness();
    await h.tick();
    h.world.database = "down";
    h.world.storeDown = true;
    const run = await h.tick();
    assert.equal(h.emergency.length, 1);
    const [payload] = h.emergency;
    assert.equal(payload.priority, "critical");
    assert.match(payload.subject, /^\[TradeCatch CRITICAL\] .*[Dd]atabase/);
    const labels = payload.lines.map((l) => l.label);
    for (const expected of ["Service", "Severity", "Category", "Alert sent"]) assert.ok(labels.includes(expected), expected);
    assert.doesNotThrow(() => assertAlertSafe({ subject: payload.subject, title: payload.title, lines: payload.lines }));
    assert.doesNotMatch(JSON.stringify(payload), /hunter2|postgres:\/\/|db\.internal/);
    assert.equal(run.emergency, "sent");
  });

  it("repeats the emergency email with the same key inside a 15-minute window and a new key after it", async () => {
    const h = harness();
    await h.tick();
    h.world.database = "down";
    h.world.storeDown = true;
    await h.tick();
    await h.tick();
    await h.tick(20);
    const keys = h.emergency.map((p) => p.idempotencyKey);
    assert.equal(keys[0], keys[1], "same window, same key: the provider drops the repeat");
    assert.notEqual(keys[1], keys[2]);
  });

  it("on recovery records the outage as a resolved critical incident with its true start, once", async () => {
    const h = harness();
    await h.tick();
    const lastGoodRun = h.now().toISOString();
    h.world.database = "down";
    h.world.storeDown = true;
    for (let i = 0; i < 9; i += 1) await h.tick();
    h.world.database = "ok";
    h.world.storeDown = false;
    await h.tick();
    await h.tick();
    const outages = (await h.incidents()).filter((i) => i.fingerprint === DATABASE_UNAVAILABLE_FINGERPRINT);
    assert.equal(outages.length, 1);
    assert.equal(outages[0].priority, "critical");
    assert.equal(incidentState(outages[0].status), "resolved");
    assert.equal(outages[0].firstSeenAt, lastGoodRun);
    assert.deepEqual(h.sent.map((p) => p.kind), ["recovered"]);
    assert.match(outages[0].summary ?? "", /minutes/);
  });

  it("says why: the emergency email carries the database's failure code and what it usually means", async () => {
    // 2026-11-24: fourteen emails said only "did not answer", so an
    // authentication refusal could not be told from a timeout.
    const h = harness();
    await h.tick();
    h.world.database = "down";
    h.world.storeDown = true;
    h.world.storeError = Object.assign(
      new Error('password authentication failed for user "postgres.abcdefghijklmnop" postgres://u:hunter2@db.internal'), // secret-scan: allow
      { code: "28P01" },
    );
    const run = await h.tick();
    const [payload] = h.emergency;
    const line = (label: string) => payload.lines.find((l) => l.label === label)?.value;
    assert.equal(line("Failure code"), "28P01");
    assert.match(line("Likely cause") ?? "", /refused the login.*DATABASE_URL/);
    assert.equal(line("Database check"), "read failed, write failed");
    assert.equal(run.storageFailure, "28P01");
    assert.doesNotThrow(() => assertAlertSafe({ subject: payload.subject, title: payload.title, lines: payload.lines }));
    assert.doesNotMatch(JSON.stringify(payload), /hunter2|postgres:\/\/|abcdefghijklmnop|password authentication/);
  });

  it("falls back to the probe's code when the storage error carries none", async () => {
    const h = harness();
    await h.tick();
    h.world.database = "down";
    h.world.probeCode = "CONNECT_TIMEOUT";
    h.world.storeDown = true;
    await h.tick();
    const value = (label: string) => h.emergency[0].lines.find((l) => l.label === label)?.value;
    assert.equal(value("Failure code"), "CONNECT_TIMEOUT");
    assert.match(value("Likely cause") ?? "", /did not answer in time/);
  });

  it("a missing DATABASE_URL is an outage, not a quiet run on memory", async () => {
    const h = harness({ databaseUnconfigured: true });
    const run = await h.tick();
    assert.equal(run.emergency, "sent");
    assert.equal(run.storageFailure, "NOT_CONFIGURED");
    assert.equal(run.checks.database, "unavailable");
    const [payload] = h.emergency;
    assert.equal(payload.lines.find((l) => l.label === "Failure code")?.value, "NOT_CONFIGURED");
    assert.match(payload.lines.find((l) => l.label === "Likely cause")?.value ?? "", /DATABASE_URL is not set/);
    assert.equal(await h.real.getMeta("monitor_last_run"), null, "nothing pretends to have been stored");
  });

  it("the resolution names the range of database-down references it closes", async () => {
    const h = harness();
    await h.tick();
    h.world.database = "down";
    h.world.storeDown = true;
    for (let i = 0; i < 40; i += 1) await h.tick();
    h.world.database = "ok";
    h.world.storeDown = false;
    await h.tick();
    const references = h.emergency.map((p) => p.lines.find((l) => l.label === "Diagnostic reference")!.value);
    assert.ok(new Set(references).size >= 3, "one window per 15 minutes");
    const [resolved] = h.sent;
    assert.equal(resolved.kind, "recovered");
    const happened = resolved.lines.find((l) => l.label === "What happened")?.value ?? "";
    const [, first, last] = happened.match(/between dbdown-(\d+) and dbdown-(\d+)/) ?? [];
    assert.ok(first && last, happened);
    for (const reference of references) {
      const n = Number(reference.replace("dbdown-", ""));
      assert.ok(n >= Number(first) && n <= Number(last), `${reference} is inside ${first}..${last}`);
    }
    assert.doesNotThrow(() => assertAlertSafe({ lines: resolved.lines }));
  });

  it("reports no emergency destination instead of pretending it sent one", async () => {
    const h = harness({ emergency: false });
    await h.tick();
    h.world.database = "down";
    h.world.storeDown = true;
    assert.equal((await h.tick()).emergency, "not_configured");
  });

  it("a short gap between runs is not an outage, and the very first run has nothing to compare", async () => {
    const h = harness();
    await h.tick();
    await h.tick(2);
    assert.equal((await h.incidents()).length, 0);
    const fresh = harness();
    await fresh.tick(30);
    assert.equal((await fresh.incidents()).length, 0);
  });

  it("a long silent gap with a healthy database is still recorded: the monitor itself was blind", async () => {
    const h = harness();
    await h.tick();
    await h.tick(12);
    const [incident] = await h.incidents();
    assert.equal(incident.priority, "critical");
    assert.equal(incidentState(incident.status), "resolved");
  });

  it("a persistently slow database is a warning, not an outage", async () => {
    const h = harness();
    h.world.database = "slow";
    for (let i = 0; i < T.database.slowConsecutive; i += 1) await h.tick();
    const [incident] = await h.incidents();
    assert.equal(incident.fingerprint, "database:slow");
    assert.equal(incident.priority, "warning");
    assert.equal(h.emergency.length, 0);
  });
});

describe("API traffic and receptionist signals through the monitor", () => {
  it("MON-02: a server-error rate over the threshold opens an incident", async () => {
    const h = harness();
    await h.real.addBuckets([h.bucket(0, { total: 40, s2xx: 12, s5xx: 28, lat: [40, 0, 0, 0, 0, 0, 0] })]);
    await h.tick(0);
    const [incident] = await h.incidents();
    assert.equal(incident.priority, "critical");
    assert.equal(h.sent.length, 1);
  });

  it("MON-03: isolated 403s and 429s among healthy traffic raise nothing", async () => {
    const h = harness();
    await h.real.addBuckets([h.bucket(0, { total: 100, s2xx: 97, s403: 2, s429: 1, lat: [100, 0, 0, 0, 0, 0, 0] })]);
    await h.tick(0);
    assert.equal((await h.incidents()).length, 0);
    assert.equal(h.sent.length, 0);
  });

  it("MON-04: failed receptionist calls become a high incident and one email", async () => {
    const h = harness();
    h.world.signals.calls = { totalSessions: 9, failedSessions: 5, hungUpSessions: 0, staleUnfinalized: 0 };
    await h.tick();
    const [incident] = await h.incidents();
    assert.equal(incident.priority, "high");
    assert.equal(h.sent.length, 1);
  });

  it("MON-05: a pile of normal hang-ups raises nothing", async () => {
    const h = harness();
    h.world.signals.calls = { totalSessions: 30, failedSessions: 0, hungUpSessions: 30, staleUnfinalized: 0 };
    await h.tick();
    assert.equal((await h.incidents()).length, 0);
    assert.equal(h.sent.length, 0);
  });

  it("MON-10: the same condition across many runs is one incident and one email", async () => {
    const h = harness();
    h.world.signals.sms = { failed: 14, total: 20 };
    for (let i = 0; i < 6; i += 1) await h.tick();
    assert.equal((await h.incidents()).length, 1);
    assert.equal(h.sent.length, 1);
    assert.ok(((await h.incidents())[0].occurrenceCount ?? 0) >= 6);
  });

  it("MON-11: resolves itself once the condition clears for the quiet period", async () => {
    const h = harness();
    h.world.signals.sms = { failed: 14, total: 20 };
    await h.tick();
    h.world.signals = emptySignals();
    for (let i = 0; i < 20; i += 1) await h.tick();
    assert.equal(incidentState((await h.incidents())[0].status), "resolved");
  });
});

describe("MON-16 monitoring never breaks anything", () => {
  it("survives a website probe, a collector and the outbox all failing, and still checks the rest", async () => {
    const h = harness();
    h.world.websiteThrows = true;
    h.world.collectThrows = true;
    h.world.deliverThrows = true;
    h.world.database = "down";
    const run = await h.tick();
    assert.equal(run.checks.website, "not_measured");
    assert.equal((await h.incidents()).length, 1, "the database incident was still recorded");
  });

  it("never rejects, even when every storage call fails and nothing can be emailed", async () => {
    const h = harness({ emergency: false });
    h.world.storeDown = true;
    h.world.database = "down";
    await assert.doesNotReject(() => h.tick());
  });

  it("an engine failure on one finding does not stop the others", async () => {
    const h = harness();
    h.world.signals.sms = { failed: 14, total: 20 };
    h.world.signals.calls = { totalSessions: 9, failedSessions: 5, hungUpSessions: 0, staleUnfinalized: 0 };
    const original = h.real.touchIncident.bind(h.real);
    let first = true;
    h.real.touchIncident = async (input) => {
      if (first) {
        first = false;
        throw new Error("transient");
      }
      return original(input);
    };
    await h.tick();
    assert.equal((await h.incidents()).length, 1);
  });

  it("reports signals it could not measure instead of treating them as healthy", async () => {
    const h = harness();
    h.world.degraded = ["calendar_credentials"];
    const run = await h.tick();
    assert.deepEqual(run.degraded, ["calendar_credentials"]);
    const meta = await h.real.getMeta("monitor_last_run");
    assert.deepEqual(JSON.parse(meta?.value ?? "{}").degraded, ["calendar_credentials"]);
  });

  it("with nothing to collect signals from (no database), says the signals were not measured instead of implying they were fine", async () => {
    const h = harness({ noSignals: true });
    const run = await h.tick();
    assert.deepEqual(run.degraded, ["signals"]);
    assert.deepEqual(JSON.parse((await h.real.getMeta("monitor_last_run"))?.value ?? "{}").degraded, ["signals"]);
  });

  it("records when it last ran, for the dashboard's freshness check", async () => {
    const h = harness();
    await h.tick();
    const meta = await h.real.getMeta("monitor_last_run");
    assert.equal(JSON.parse(meta?.value ?? "{}").at, h.now().toISOString());
  });

  it("tidies old data at most about once an hour, not every minute", async () => {
    const h = harness();
    for (let i = 0; i < 5; i += 1) await h.tick();
    assert.equal(h.pruneCalls.length, 1);
    await h.tick(61);
    assert.equal(h.pruneCalls.length, 2);
  });
});

describe("website probe", () => {
  const record = (response: () => Response | Promise<Response>, over: { timeoutMs?: number } = {}) =>
    probeWebsite({
      fetchImpl: (async () => response()) as unknown as typeof fetch,
      url: "https://example.test/",
      target: "page",
      timeoutMs: over.timeoutMs ?? 1000,
      now: () => new Date(START),
      clock: () => START,
    });

  it("is ok for a normal page, and records the status and how long it took", async () => {
    const result = await record(() => new Response("<html>", { status: 200 }));
    assert.deepEqual([result.target, result.ok, result.statusCode], ["page", true, 200]);
    assert.equal(result.at, new Date(START).toISOString());
  });

  it("fails on server errors, a missing page, and a connection error", async () => {
    assert.equal((await record(() => new Response("", { status: 503 }))).ok, false);
    assert.equal((await record(() => new Response("", { status: 502 }))).ok, false);
    assert.equal((await record(() => new Response("", { status: 404 }))).ok, false);
    const thrown = await record(() => {
      throw new Error("ECONNRESET");
    });
    assert.deepEqual([thrown.ok, thrown.statusCode], [false, undefined]);
  });

  it("does not call the site down just because it refused an unauthenticated or rate-limited probe", async () => {
    for (const status of [401, 403, 429]) assert.equal((await record(() => new Response("", { status }))).ok, true, String(status));
  });

  it("gives up on a hung request instead of waiting forever", async () => {
    const started = Date.now();
    const result = await probeWebsite({
      fetchImpl: ((_url: unknown, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch,
      url: "https://example.test/",
      target: "page",
      timeoutMs: 20,
      now: () => new Date(START),
    });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 1000);
  });

  it("sends no credentials and identifies itself", async () => {
    let seen: RequestInit | undefined;
    await probeWebsite({
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        seen = init;
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
      url: "https://example.test/api/health",
      target: "api",
      timeoutMs: 1000,
      now: () => new Date(START),
    });
    const headers = new Headers(seen?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    assert.match(headers.get("user-agent") ?? "", /TradeCatch-Monitor/);
  });
});
