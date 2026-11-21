import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlertPayload } from "../../src/product/reliability/alerts";
import { ReliabilityError as FromErrors } from "../../src/product/reliability/errors";
import { createMemoryReliabilityStore } from "../../src/product/reliability/store";
import {
  createReliabilityService,
  ReliabilityError,
  type Probe,
} from "../../src/product/reliability/service";
import { DEFAULT_THRESHOLDS } from "../../src/product/reliability/thresholds";
import { incidentState, type BucketDelta } from "../../src/product/reliability/types";

const MIN = 60_000;
const T0 = Date.parse("2026-11-20T15:00:00.000Z");

const okProbes: Probe[] = [
  { service: "api", status: "healthy", state: "operational" },
  { service: "database", status: "healthy", state: "operational" },
  { service: "jobs", status: "healthy", state: "operational" },
];

function harness(opts: { production?: boolean; probes?: () => Probe[] } = {}) {
  const store = createMemoryReliabilityStore();
  let clock = T0;
  const sent: AlertPayload[] = [];
  const service = createReliabilityService({
    store,
    now: () => new Date(clock),
    environment: () => (opts.production === false ? "staging" : "production"),
    probe: async () => (opts.probes ? opts.probes() : okProbes),
    notifyAdmin: async (payload) => {
      sent.push(payload);
    },
    siteUrl: () => "https://example.test",
  });
  return { store, service, sent, advance: (ms: number) => void (clock += ms), now: () => new Date(clock) };
}

const stripeError = (over: Record<string, unknown> = {}) => ({
  service: "stripe",
  operation: "webhook.invoice.payment_failed",
  errorCode: "sync_failed",
  severity: "high" as const,
  retryable: true,
  ...over,
});

describe("recording errors", () => {
  it("MON-10: groups identical failures into one incident whose count includes the errors that crossed the threshold", async () => {
    const { service, store } = harness();
    await service.recordError(stripeError());
    await service.recordError(stripeError());
    assert.equal((await store.listIncidents()).length, 0, "two high errors are below the threshold");
    await service.recordError(stripeError());
    for (let i = 0; i < 4; i += 1) await service.recordError(stripeError());
    const incidents = await store.listIncidents();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].occurrenceCount, 7);
    assert.equal(incidents[0].service, "stripe");
    assert.match(incidents[0].fingerprint ?? "", /^stripe:webhook\.invoice\.payment_failed:sync_failed$/);
    const errors = await store.listErrors({ fingerprint: incidents[0].fingerprint });
    assert.equal(errors.length, 7);
  });

  it("does not merge different operations or codes, and a request id never splits one", async () => {
    const { service, store } = harness();
    for (let i = 0; i < 3; i += 1) await service.recordError(stripeError({ operation: `webhook.evt_${i}abcdef12`, requestId: `req_${i}` }));
    for (let i = 0; i < 2; i += 1) await service.recordError(stripeError({ errorCode: "other_code" }));
    const incidents = await store.listIncidents();
    assert.equal(incidents.length, 1, "ids in the operation fold into one fingerprint; two of another code stay below threshold");
  });

  it("opens a critical incident on the first critical error, queues the alert, and does not send from the request path", async () => {
    const { service, store, sent } = harness();
    await service.recordError(stripeError({ severity: "critical", errorCode: "db_down" }));
    const [incident] = await store.listIncidents();
    assert.equal(incident.priority, "critical");
    assert.equal((await store.listAlertDeliveries()).length, 1);
    assert.equal(sent.length, 0, "recordError only enqueues, so a customer request never waits on email");
    const run = await service.deliverAlerts();
    assert.equal(run.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^\[TradeCatch CRITICAL\]/);
  });

  it("needs five medium errors and never raises low ones", async () => {
    const { service, store } = harness();
    for (let i = 0; i < 4; i += 1) await service.recordError(stripeError({ severity: "medium", errorCode: "slow" }));
    assert.equal((await store.listIncidents()).length, 0);
    await service.recordError(stripeError({ severity: "medium", errorCode: "slow" }));
    assert.equal((await store.listIncidents())[0].priority, "warning");
    for (let i = 0; i < 20; i += 1) await service.recordError(stripeError({ severity: "low", errorCode: "noise" }));
    assert.equal((await store.listIncidents()).length, 1);
  });

  it("errors outside the window do not count toward the threshold", async () => {
    const { service, store, advance } = harness();
    await service.recordError(stripeError());
    await service.recordError(stripeError());
    advance(DEFAULT_THRESHOLDS.errors.high.windowMs + MIN);
    await service.recordError(stripeError());
    assert.equal((await store.listIncidents()).length, 0);
  });

  it("records simulated failures as incidents but never queues or sends an alert", async () => {
    const { service, store, sent } = harness();
    for (let i = 0; i < 3; i += 1) await service.recordError(stripeError({ simulated: true }));
    assert.equal((await store.listIncidents()).length, 1);
    assert.equal((await store.listAlertDeliveries()).length, 0);
    await service.deliverAlerts();
    assert.equal(sent.length, 0);
  });

  it("MON-15: what reaches the administrator carries no secret even when a code or operation is polluted", async () => {
    const { service, sent } = harness();
    for (let i = 0; i < 3; i += 1)
      await service.recordError(
        stripeError({
          errorCode: "sk_live_abcdefghijklmnop", // secret-scan: allow
          operation: "webhook.owner@example.com",
          detail: "Bearer abc.def.ghi card 4242 4242 4242 4242",
          organizationId: "org_123",
        }),
      );
    await service.deliverAlerts();
    const text = JSON.stringify(sent);
    for (const secret of ["sk_live_abcdef", "owner@example.com", "abc.def.ghi", "4242"]) assert.equal(text.includes(secret), false, secret);
    assert.ok(sent[0].lines.some((l) => l.label === "Business" && l.value === "org_123"));
  });
});

describe("health checks through overview", () => {
  it("raises an incident for a failing required service, delivers it, and resolves with a recovery notice", async () => {
    let down = true;
    const h = harness({
      probes: () => okProbes.map((p) => (p.service === "jobs" && down ? { ...p, status: "degraded" as const, state: "configured" as const } : p)),
    });
    await h.service.overview();
    assert.equal(h.sent.length, 0, "a read-only dashboard never alerts");
    await h.service.overview({ notifyOnFailure: true });
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].priority, "high");
    const [incident] = await h.store.listIncidents();
    assert.equal(incident.service, "health:jobs");
    down = false;
    h.advance(16 * MIN);
    await h.service.overview({ notifyOnFailure: true });
    assert.equal((await h.store.getIncident(incident.id))?.status, "open", "one clean tick is not enough");
    h.advance(DEFAULT_THRESHOLDS.healthChecks.quietMs);
    await h.service.overview({ notifyOnFailure: true });
    assert.equal(incidentState((await h.store.getIncident(incident.id))!.status), "resolved");
    assert.deepEqual(h.sent.map((p) => p.kind), ["opened", "recovered"]);
  });

  it("MON-16: a notifier that throws never makes overview throw", async () => {
    const store = createMemoryReliabilityStore();
    const service = createReliabilityService({
      store,
      now: () => new Date(T0),
      environment: () => "production",
      probe: async () => [{ service: "database", status: "unavailable", state: "configured" }],
      notifyAdmin: async () => {
        throw new Error("smtp password=hunter2");
      },
    });
    const overview = await service.overview({ notifyOnFailure: true });
    assert.equal(overview.overall, "unavailable");
    const failed = await store.listAlertDeliveries({ failedOnly: true });
    assert.equal(failed[0].lastError, "send_failed");
  });
});

describe("incident actions", () => {
  it("acknowledges with the actor, refuses a resolved or unknown incident, and exposes one error type", async () => {
    const { service, store } = harness();
    await service.recordError(stripeError({ severity: "critical" }));
    const [incident] = await store.listIncidents();
    const acked = await service.acknowledge(incident.id, "super-admin");
    assert.equal(incidentState(acked.status), "acknowledged");
    assert.equal(acked.acknowledgedBy, "super-admin");
    await service.resolve(incident.id, "super-admin");
    await assert.rejects(() => service.acknowledge(incident.id, "x"), (e) => e instanceof ReliabilityError && e.status === 409);
    await assert.rejects(() => service.acknowledge("missing", "x"), (e) => e instanceof ReliabilityError && e.status === 404);
    assert.equal(ReliabilityError, FromErrors, "routes import it from service; the engine throws the same class");
  });

  it("returns the incident detail with its history, deliveries and related errors", async () => {
    const { service, store } = harness();
    for (let i = 0; i < 3; i += 1) await service.recordError(stripeError());
    const [incident] = await store.listIncidents();
    await service.deliverAlerts();
    const detail = await service.incidentDetail(incident.id);
    assert.equal(detail?.incident.id, incident.id);
    assert.ok(detail!.events.some((e) => e.kind === "opened"));
    assert.ok(detail!.events.some((e) => e.kind === "admin_notified"));
    assert.equal(detail!.deliveries.length, 1);
    assert.equal(detail!.errors.length, 3);
    assert.equal(await service.incidentDetail("missing"), null);
  });
});

describe("overview traffic is real, not simulated", () => {
  const bucket = (minutesAgo: number, over: Partial<BucketDelta> = {}): BucketDelta => ({
    at: new Date(T0 - minutesAgo * MIN).toISOString(),
    scope: "api",
    total: 100,
    s2xx: 90,
    s3xx: 0,
    s401: 2,
    s403: 1,
    s429: 2,
    s4xxOther: 1,
    s5xx: 4,
    lat: [60, 25, 10, 3, 2, 0, 0],
    ...over,
  });

  it("summarises the last 15 minutes of recorded buckets and ignores older ones and page traffic", async () => {
    const { service, store } = harness();
    await store.addBuckets([bucket(1), bucket(2), bucket(40), bucket(1, { scope: "page", total: 999, s5xx: 999 })]);
    const overview = await service.overview();
    assert.equal(overview.requests, 200);
    assert.equal(overview.serverErrors, 8);
    assert.equal(overview.clientErrors, 12);
    assert.equal(Math.round(overview.errorRate * 1000), 40);
    assert.equal(overview.p95Ms, 500, "190 of 200 requests finished within 500 ms, so the 95th percentile is the <=500 ms bin");
    assert.equal(overview.p50Ms, 100);
    assert.equal(overview.trafficAvailable, true);
  });

  it("says no traffic has been recorded instead of inventing numbers", async () => {
    const { service } = harness();
    const overview = await service.overview();
    assert.equal(overview.requests, 0);
    assert.equal(overview.errorRate, 0);
    assert.equal(overview.trafficAvailable, false);
  });
});

describe("recording an outage after the fact", () => {
  it("is available on the service, so the monitor can record a database outage once it is back", async () => {
    const { service, store, now } = harness();
    const startedAt = new Date(now().getTime() - 6 * MIN).toISOString();
    const incident = await service.recordPastOutage({
      fingerprint: "health:database",
      service: "health:database",
      category: "health_check",
      priority: "critical",
      title: "Database or monitoring was unavailable",
      correlationId: "gap_1",
      startedAt,
    });
    assert.equal(incidentState(incident.status), "resolved");
    assert.equal((await store.listIncidents()).length, 1);
  });
});
