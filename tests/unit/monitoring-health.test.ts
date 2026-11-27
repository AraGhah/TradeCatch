/**
 * KAN-28 the System Health data the admin dashboard shows (MON-14): per-area
 * status for website, API, receptionist, SMS, Stripe, database, calendar and
 * automations; how recently the monitor ran; and the alert delivery summary.
 *
 * Every state is derived from real recorded data. An area the monitor has not
 * measured (never ran, ran too long ago, or that collector failed) is
 * "unknown", never "healthy".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSystemHealth } from "../../src/product/admin-console/health";
import { createReliabilityService, type Probe } from "../../src/product/reliability/service";
import { createMemoryReliabilityStore } from "../../src/product/reliability/store";
import { DEFAULT_THRESHOLDS as T } from "../../src/product/reliability/thresholds";
import { LAST_RUN_META } from "../../src/product/reliability/watch";

const MIN = 60_000;
const NOW = Date.parse("2026-11-20T15:00:00.000Z");
const AREAS = ["website", "api", "receptionist", "sms", "stripe", "database", "calendar", "automations"];

const okProbes: Probe[] = [
  { service: "api", status: "healthy", state: "operational" },
  { service: "database", status: "healthy", state: "operational" },
  { service: "jobs", status: "healthy", state: "operational" },
];

function harness() {
  const store = createMemoryReliabilityStore();
  const service = createReliabilityService({
    store,
    now: () => new Date(NOW),
    environment: () => "production",
    probe: async () => okProbes,
    notifyAdmin: async () => undefined,
    siteUrl: () => "https://example.test",
  });
  const heartbeat = (minutesAgo: number, extra: Record<string, unknown> = {}) =>
    store.setMeta(
      LAST_RUN_META,
      JSON.stringify({ at: new Date(NOW - minutesAgo * MIN).toISOString(), website: "ok", database: "ok", degraded: [], ...extra }),
      new Date(NOW - minutesAgo * MIN).toISOString(),
    );
  const incident = (over: Record<string, unknown>) =>
    service.reportIncident({
      fingerprint: "x:y",
      service: "website",
      category: "unavailable",
      priority: "critical",
      title: "Website is unreachable",
      quietMs: 5 * MIN,
      correlationId: "c1",
      simulated: false,
      ...over,
    } as Parameters<typeof service.reportIncident>[0]);
  const load = async () => loadSystemHealth(service, {}, {}, new Date(NOW));
  const area = async (key: string) => (await load()).areas.find((a) => a.key === key)!;
  return { store, service, heartbeat, incident, load, area };
}

describe("the monitor's own freshness", () => {
  it("says it has never run when there is no heartbeat", async () => {
    const h = harness();
    const { monitor } = await h.load();
    assert.equal(monitor.state, "never");
    assert.equal(monitor.lastRunAt, null);
  });

  it("is running when the last run is recent, with its age", async () => {
    const h = harness();
    await h.heartbeat(1);
    const { monitor } = await h.load();
    assert.equal(monitor.state, "running");
    assert.equal(monitor.ageMs, MIN);
    assert.equal(monitor.lastRunAt, new Date(NOW - MIN).toISOString());
  });

  it("is stale once it has missed more runs than the gap threshold allows", async () => {
    const h = harness();
    await h.heartbeat(T.monitor.gapMs / MIN + 1);
    assert.equal((await h.load()).monitor.state, "stale");
  });

  it("survives a damaged heartbeat", async () => {
    const h = harness();
    await h.store.setMeta(LAST_RUN_META, "not json", new Date(NOW - MIN).toISOString());
    const { monitor } = await h.load();
    assert.equal(monitor.state, "running", "falls back to the stored timestamp");
  });
});

describe("MON-14 per-area status is real, and honest about what it has not measured", () => {
  it("covers exactly the areas the task lists", async () => {
    const h = harness();
    await h.heartbeat(1);
    assert.deepEqual((await h.load()).areas.map((a) => a.key), AREAS);
  });

  it("all healthy when the monitor is running, measured everything and found nothing", async () => {
    const h = harness();
    await h.heartbeat(1);
    for (const a of (await h.load()).areas) assert.equal(a.state, "healthy", a.key);
  });

  it("all unknown when the monitor has never run or is stale: it must not claim health it has not checked", async () => {
    const never = harness();
    for (const a of (await never.load()).areas) assert.equal(a.state, "unknown", `never: ${a.key}`);
    const stale = harness();
    await stale.heartbeat(30);
    for (const a of (await stale.load()).areas) assert.equal(a.state, "unknown", `stale: ${a.key}`);
  });

  it("an active critical or high incident makes its area 'incident', and only that area", async () => {
    const h = harness();
    await h.heartbeat(1);
    await h.incident({ fingerprint: "website:unavailable:page", service: "website" });
    const areas = (await h.load()).areas;
    assert.equal(areas.find((a) => a.key === "website")?.state, "incident");
    assert.equal(areas.find((a) => a.key === "website")?.activeIncidents, 1);
    for (const a of areas.filter((x) => x.key !== "website")) assert.equal(a.state, "healthy", a.key);
  });

  it("an incident that has no fresh heartbeat behind it is still shown: incidents are facts, health is a measurement", async () => {
    const h = harness();
    await h.incident({ fingerprint: "stripe:webhook_failures", service: "stripe", priority: "high", title: "Stripe webhooks failing" });
    const stripe = await h.area("stripe");
    assert.equal(stripe.state, "incident");
  });

  it("an acknowledged incident is still active, so the area stays 'incident' until it is resolved", async () => {
    const h = harness();
    await h.heartbeat(1);
    const { incident } = await h.incident({ fingerprint: "stripe:webhook_failures", service: "stripe", priority: "high", title: "Stripe webhooks failing" });
    await h.service.acknowledge(incident.id, "ops:alice");
    assert.equal((await h.area("stripe")).state, "incident");
    await h.service.resolve(incident.id, "ops:alice");
    assert.equal((await h.area("stripe")).state, "healthy");
  });

  it("only warnings make an area 'degraded'", async () => {
    const h = harness();
    await h.heartbeat(1);
    await h.incident({ fingerprint: "sms:delivery_failures", service: "twilio_sms", priority: "warning", title: "Some texts are failing" });
    assert.equal((await h.area("sms")).state, "degraded");
  });

  it("ignores simulated incidents", async () => {
    const h = harness();
    await h.heartbeat(1);
    await h.incident({ simulated: true });
    assert.equal((await h.area("website")).state, "healthy");
  });

  it("maps each provider's incidents to the area an administrator expects", async () => {
    const h = harness();
    await h.heartbeat(1);
    const cases: [string, string][] = [
      ["ai_receptionist", "receptionist"],
      ["twilio_voice", "receptionist"],
      ["google_calendar", "calendar"],
      ["calcom", "calendar"],
      ["jobs", "automations"],
      ["health:jobs", "automations"],
      ["health:database", "database"],
      ["database", "database"],
      ["api", "api"],
    ];
    for (const [index, [serviceName]] of cases.entries())
      await h.incident({ fingerprint: `f${index}`, service: serviceName, priority: "high", title: `t${index}` });
    const areas = (await h.load()).areas;
    for (const [, expected] of cases) assert.equal(areas.find((a) => a.key === expected)?.state, "incident", expected);
  });

  it("an area whose collector failed is 'unknown' and says it was not measured", async () => {
    const h = harness();
    await h.heartbeat(1, { degraded: ["calendar_credentials", "stripe_billing"] });
    const areas = (await h.load()).areas;
    for (const key of ["calendar", "stripe"]) {
      const a = areas.find((x) => x.key === key)!;
      assert.equal(a.state, "unknown", key);
      assert.match(a.detail, /not measured/i);
    }
    assert.equal(areas.find((a) => a.key === "sms")?.state, "healthy");
  });

  it("the website is unknown when the monitor could not probe it, and failing probes are not 'healthy'", async () => {
    const unprobed = harness();
    await unprobed.heartbeat(1, { website: "not_measured" });
    assert.equal((await unprobed.area("website")).state, "unknown");
    const failing = harness();
    await failing.heartbeat(1, { website: "failing" });
    assert.equal((await failing.area("website")).state, "degraded", "one failed probe is not yet an incident, but it is not healthy either");
  });

  it("the database follows the monitor's own check", async () => {
    const down = harness();
    await down.heartbeat(1, { database: "unavailable" });
    assert.equal((await down.area("database")).state, "degraded");
    const slow = harness();
    await slow.heartbeat(1, { database: "slow" });
    assert.equal((await slow.area("database")).state, "degraded");
    const none = harness();
    await none.heartbeat(1, { database: "not_measured" });
    assert.equal((await none.area("database")).state, "unknown");
  });
});

describe("why an area is not measured is a code the console can translate", () => {
  it("is null whenever the area was measured, healthy or not", async () => {
    const h = harness();
    await h.heartbeat(1);
    await h.incident({ fingerprint: "website:unavailable:page", service: "website" });
    for (const a of (await h.load()).areas) assert.equal(a.reason, null, a.key);
  });

  it("says the monitor never ran, or has stopped running", async () => {
    const never = harness();
    for (const a of (await never.load()).areas) assert.equal(a.reason, "monitor_never", a.key);
    const stale = harness();
    await stale.heartbeat(30);
    for (const a of (await stale.load()).areas) assert.equal(a.reason, "monitor_stale", a.key);
  });

  it("says what could not be read: no public address, no database, or a failed collector", async () => {
    const h = harness();
    await h.heartbeat(1, { website: "not_measured", database: "not_measured", degraded: ["stripe_billing", "calls"] });
    const reasons = Object.fromEntries((await h.load()).areas.map((a) => [a.key, a.reason]));
    assert.equal(reasons.website, "no_address");
    assert.equal(reasons.database, "no_database");
    assert.equal(reasons.stripe, "data_unreadable");
    assert.equal(reasons.receptionist, "data_unreadable");
    assert.equal(reasons.sms, null);
  });

  it("an incident is a fact even when the area could not be measured: no reason is given", async () => {
    const h = harness();
    await h.incident({ fingerprint: "stripe:webhook_failures", service: "stripe", priority: "high", title: "Stripe webhooks failing" });
    assert.equal((await h.area("stripe")).reason, null);
  });
});

describe("alert delivery is visible", () => {
  it("shows what is waiting, what was sent, and the failures with their short codes", async () => {
    const h = harness();
    await h.heartbeat(1);
    await h.incident({ fingerprint: "website:unavailable:page", service: "website" });
    const failing = createReliabilityService({
      store: h.store,
      now: () => new Date(NOW),
      environment: () => "production",
      probe: async () => okProbes,
      notifyAdmin: async () => {
        throw new Error("smtp refused: owner@example.com");
      },
    });
    await failing.deliverAlerts();
    const { alerts } = await h.load();
    assert.equal(alerts.summary.pending, 1);
    assert.equal(alerts.failed.length, 1);
    assert.equal(alerts.failed[0].lastError, "send_failed");
    assert.doesNotMatch(JSON.stringify(alerts), /owner@example\.com|smtp/);
  });
});
