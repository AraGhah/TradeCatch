import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverDueAlerts, composeAlert, safePayload, type AlertPayload } from "../../src/product/reliability/alerts";
import {
  createIncidentEngine,
  type IncidentReport,
} from "../../src/product/reliability/incidents";
import { ReliabilityError } from "../../src/product/reliability/errors";
import { createMemoryReliabilityStore } from "../../src/product/reliability/store";
import { DEFAULT_THRESHOLDS, type MonitorThresholds } from "../../src/product/reliability/thresholds";
import { incidentState } from "../../src/product/reliability/types";

const MIN = 60_000;
const START = Date.parse("2026-11-20T15:00:00.000Z");

function harness(overrides: Partial<MonitorThresholds> = {}) {
  const store = createMemoryReliabilityStore();
  let clock = START;
  const thresholds: MonitorThresholds = { ...DEFAULT_THRESHOLDS, ...overrides };
  const engine = createIncidentEngine({
    store,
    thresholds,
    now: () => new Date(clock),
  });
  return {
    store,
    engine,
    thresholds,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => new Date(clock),
  };
}

const report = (over: Partial<IncidentReport> = {}): IncidentReport => ({
  fingerprint: "stripe:webhook_failures",
  service: "stripe",
  category: "webhook_failures",
  priority: "high",
  title: "Stripe webhooks are failing",
  summary: "3 Stripe webhook deliveries could not be processed in the last 30 minutes.",
  quietMs: 15 * MIN,
  correlationId: "req_corr_1",
  simulated: false,
  ...over,
});

describe("MON-10 repeated identical errors group into one incident", () => {
  it("counts occurrences on a single incident and alerts exactly once", async () => {
    const { engine, store } = harness();
    for (let i = 0; i < 25; i += 1) await engine.report(report());
    const incidents = await store.listIncidents();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].occurrenceCount, 25);
    assert.equal(incidents[0].fingerprint, "stripe:webhook_failures");
    const alerts = await store.listAlertDeliveries();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "opened");
  });

  it("starts the count at the errors that already crossed the threshold, then adds one per report", async () => {
    const { engine, store } = harness();
    await engine.report(report({ initialOccurrences: 3 }));
    await engine.report(report());
    await engine.report(report());
    assert.equal((await store.listIncidents())[0].occurrenceCount, 5);
  });

  it("keeps different failures apart and merges the business scope", async () => {
    const { engine, store } = harness();
    await engine.report(report({ organizationId: "biz-1" }));
    await engine.report(report({ organizationId: "biz-2" }));
    await engine.report(report({ fingerprint: "sms:delivery_failures", service: "twilio_sms", category: "delivery_failures" }));
    const incidents = await store.listIncidents();
    assert.equal(incidents.length, 2);
    const stripe = incidents.find((i) => i.service === "stripe");
    assert.equal(stripe?.organizationId, undefined, "two businesses means platform-wide");
    assert.equal(stripe?.occurrenceCount, 2);
  });
});

describe("MON-11 recovery resolves the incident and tells administrators", () => {
  it("resolves automatically after the quiet period and sends one recovery notice for a high incident", async () => {
    const { engine, store, advance } = harness();
    await engine.report(report());
    advance(10 * MIN);
    assert.equal((await engine.sweepRecovered()).length, 0, "still inside the quiet period");
    advance(10 * MIN);
    const resolved = await engine.sweepRecovered();
    assert.equal(resolved.length, 1);
    const incident = (await store.listIncidents())[0];
    assert.equal(incidentState(incident.status), "resolved");
    assert.equal(incident.resolvedBy, "auto");
    assert.ok(incident.resolvedAt);
    const kinds = (await store.listAlertDeliveries()).map((a) => a.kind).sort();
    assert.deepEqual(kinds, ["opened", "recovered"]);
    await engine.sweepRecovered();
    assert.equal((await store.listAlertDeliveries()).length, 2, "recovery is announced once");
    const history = (await store.listIncidentEvents(incident.id)).map((e) => e.kind);
    assert.ok(history.includes("opened") && history.includes("resolved"));
  });

  it("does not email a recovery for a warning", async () => {
    const { engine, store, advance } = harness();
    await engine.report(report({ priority: "warning", fingerprint: "api:latency", service: "api" }));
    advance(20 * MIN);
    await engine.sweepRecovered();
    assert.deepEqual((await store.listAlertDeliveries()).map((a) => a.kind), ["opened"]);
  });

  it("does not resolve an incident whose condition is still being reported", async () => {
    const { engine, store, advance } = harness();
    await engine.report(report());
    for (let i = 0; i < 6; i += 1) {
      advance(5 * MIN);
      await engine.report(report());
      assert.equal((await engine.sweepRecovered()).length, 0);
    }
    assert.equal((await store.listIncidents())[0].status, "open");
  });

  it("never touches incidents that predate fingerprints", async () => {
    const { engine, store, advance } = harness();
    await store.saveIncident({
      id: "legacy",
      service: "jobs",
      severity: "high",
      title: "Old",
      status: "open",
      correlationId: "c",
      createdAt: new Date(START - 99 * MIN).toISOString(),
    });
    advance(600 * MIN);
    assert.equal((await engine.sweepRecovered()).length, 0);
    assert.equal((await store.getIncident("legacy"))?.status, "open");
  });
});

describe("cooldown, reopening and escalation", () => {
  it("reopens a just-resolved incident instead of creating a second one, without re-alerting inside the cooldown", async () => {
    const { engine, store, advance } = harness();
    await engine.report(report());
    advance(20 * MIN);
    await engine.sweepRecovered();
    advance(2 * MIN);
    const again = await engine.report(report());
    assert.equal(again.outcome, "reopened");
    assert.equal((await store.listIncidents()).length, 1);
    assert.equal((await store.listIncidents())[0].reopenCount, 1);
    const opened = (await store.listAlertDeliveries()).filter((a) => a.kind === "opened");
    assert.equal(opened.length, 1, "cooldown suppresses a flapping re-alert");
  });

  it("creates a fresh incident once the reopen window has passed", async () => {
    const { engine, store, advance } = harness();
    await engine.report(report());
    advance(20 * MIN);
    await engine.sweepRecovered();
    advance(60 * MIN);
    assert.equal((await engine.report(report())).outcome, "created");
    assert.equal((await store.listIncidents()).length, 2);
  });

  it("alerts once more when an incident escalates to a higher priority", async () => {
    const { engine, store } = harness();
    await engine.report(report({ priority: "warning", fingerprint: "api:error_rate", service: "api" }));
    await engine.report(report({ priority: "warning", fingerprint: "api:error_rate", service: "api" }));
    await engine.report(report({ priority: "critical", fingerprint: "api:error_rate", service: "api", title: "Widespread server errors" }));
    await engine.report(report({ priority: "critical", fingerprint: "api:error_rate", service: "api" }));
    const incident = (await store.listIncidents())[0];
    assert.equal(incident.priority, "critical");
    assert.equal(incident.severity, "critical");
    assert.deepEqual((await store.listAlertDeliveries()).map((a) => a.kind).sort(), ["escalated", "opened"]);
  });

  it("reminds about an unacknowledged critical incident only after the reminder interval", async () => {
    const { engine, store, advance, thresholds } = harness();
    const critical = report({ priority: "critical", fingerprint: "website:unavailable:page", service: "website", quietMs: 3 * MIN });
    await engine.report(critical);
    advance(thresholds.alerts.reminderMs.critical - MIN);
    await engine.report(critical);
    assert.equal((await store.listAlertDeliveries()).length, 1);
    advance(2 * MIN);
    await engine.report(critical);
    assert.deepEqual((await store.listAlertDeliveries()).map((a) => a.kind).sort(), ["opened", "reminder"]);
    await engine.report(critical);
    assert.equal((await store.listAlertDeliveries()).length, 2);
  });
});

describe("acknowledging an incident", () => {
  it("moves Active to Acknowledged, records who, and silences reminders", async () => {
    const { engine, store, advance, thresholds } = harness();
    const critical = report({ priority: "critical", fingerprint: "database:unavailable", service: "database", quietMs: 5 * MIN });
    await engine.report(critical);
    const id = (await store.listIncidents())[0].id;
    assert.equal(incidentState((await store.getIncident(id))!.status), "active");
    const acked = await engine.acknowledge(id, "admin@example.test");
    assert.equal(incidentState(acked.status), "acknowledged");
    assert.equal(acked.acknowledgedBy, "admin@example.test");
    const events = (await store.listIncidentEvents(id)).filter((e) => e.kind === "acknowledged");
    assert.equal(events.length, 1);
    await engine.acknowledge(id, "admin@example.test");
    assert.equal((await store.listIncidentEvents(id)).filter((e) => e.kind === "acknowledged").length, 1, "idempotent");
    advance(thresholds.alerts.reminderMs.critical + MIN);
    await engine.report(critical);
    assert.equal((await store.listAlertDeliveries()).filter((a) => a.kind === "reminder").length, 0);
  });

  it("an acknowledged incident that gets worse still alerts", async () => {
    const { engine, store } = harness();
    await engine.report(report({ priority: "warning", fingerprint: "api:error_rate", service: "api" }));
    const id = (await store.listIncidents())[0].id;
    await engine.acknowledge(id, "a");
    await engine.report(report({ priority: "critical", fingerprint: "api:error_rate", service: "api" }));
    assert.ok((await store.listAlertDeliveries()).some((a) => a.kind === "escalated"));
  });

  it("refuses to acknowledge an unknown or resolved incident and resolves manually", async () => {
    const { engine, store } = harness();
    await assert.rejects(() => engine.acknowledge("nope", "a"), (e) => e instanceof ReliabilityError && e.status === 404);
    await engine.report(report());
    const id = (await store.listIncidents())[0].id;
    const resolved = await engine.resolve(id, "admin@example.test");
    assert.equal(resolved.resolvedBy, "admin@example.test");
    assert.equal((await engine.resolve(id, "admin@example.test")).status, "resolved", "double click is harmless");
    await assert.rejects(() => engine.acknowledge(id, "a"), (e) => e instanceof ReliabilityError && e.status === 409);
  });

  it("a manual resolution of an alerted incident sends exactly one resolution email (2026-11-25 20:45 UTC had none)", async () => {
    const { engine, store } = harness();
    await engine.report(report({ priority: "critical", fingerprint: "website:unavailable", service: "website" }));
    const id = (await store.listIncidents())[0].id;
    await engine.resolve(id, "admin@example.test");
    await engine.resolve(id, "admin@example.test");
    const recovered = (await store.listAlertDeliveries()).filter((a) => a.kind === "recovered");
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].incidentId, id);
    const payload = composeAlert("recovered", (await store.getIncident(id))!, { now: new Date(START) });
    assert.ok(payload.lines.some((l) => l.label === "Resolved by" && /administrator/.test(l.value)));
  });

  it("a manual resolution of a warning, or of an incident never alerted, sends nothing", async () => {
    const { engine, store } = harness();
    await engine.report(report({ priority: "warning", fingerprint: "api:latency", service: "api" }));
    await engine.resolve((await store.listIncidents())[0].id, "a");
    assert.equal((await store.listAlertDeliveries()).filter((a) => a.kind === "recovered").length, 0);
  });
});

describe("website incidents resolve only on sustained successful checks", () => {
  const site = report({
    fingerprint: "website:unavailable",
    service: "website",
    category: "unavailable",
    priority: "critical",
    title: "Website is unreachable",
    quietMs: 3 * MIN,
  });

  it("quiet time alone does not resolve it; five good checks on every address do", async () => {
    const { engine, store, advance, now } = harness();
    await engine.report(site);
    advance(10 * MIN);
    assert.equal((await engine.sweepRecovered()).length, 0, "no checks at all: no evidence");
    for (let i = 0; i < 4; i += 1)
      await store.saveProbe({ at: new Date(now().getTime() - (4 - i) * 1000).toISOString(), target: "page", ok: true, durationMs: 50 });
    assert.equal((await engine.sweepRecovered()).length, 0, "four good checks are not enough");
    await store.saveProbe({ at: now().toISOString(), target: "page", ok: true, durationMs: 50 });
    const [resolved] = await engine.sweepRecovered();
    assert.equal(resolved.status, "resolved");
    const events = await store.listIncidentEvents(resolved.id);
    assert.ok(events.some((e) => e.kind === "resolved" && /last 5 availability checks succeeded/.test(e.detail ?? "")));
  });

  it("an older per-address incident needs only its own address to recover", async () => {
    const { engine, store, advance, now } = harness();
    await engine.report({ ...site, fingerprint: "website:unavailable:api" });
    advance(10 * MIN);
    for (let i = 0; i < 5; i += 1) {
      const at = new Date(now().getTime() - i * 1000).toISOString();
      await store.saveProbe({ at, target: "api", ok: true, durationMs: 50 });
      await store.saveProbe({ at, target: "page", ok: false, durationMs: 50 });
    }
    assert.equal((await engine.sweepRecovered()).length, 1);
  });
});

describe("alert identifiers are not mistaken for phone numbers", () => {
  it("keeps the full alert for an incident id whose last UUID group is all digits", async () => {
    const { engine, store } = harness();
    await engine.report(report({ priority: "critical" }));
    const incident = { ...(await store.listIncidents())[0], id: "inc_9fc51ebf-83e6-4992-b530-272773860567", correlationId: "mon_de579d9c-3de8-497b-ac5b-58c7af2d4913" };
    const payload = safePayload(composeAlert("opened", incident, { now: new Date(START), siteUrl: "https://tradecatch.ca" }));
    assert.equal(payload.title, "Stripe webhooks are failing");
    assert.ok(payload.lines.some((l) => l.label === "Diagnostic reference" && l.value === incident.id));
  });

  it("a fallback for a resolution says RESOLVED and keeps every safe line", () => {
    const base = composeAlert(
      "recovered",
      {
        id: "inc_1",
        service: "website",
        severity: "critical",
        priority: "critical",
        title: "Website is unreachable",
        status: "resolved",
        correlationId: "mon_1",
        createdAt: new Date(START).toISOString(),
        resolvedAt: new Date(START).toISOString(),
      },
      { now: new Date(START) },
    );
    const leaked = { ...base, lines: [...base.lines, { label: "Contact", value: "call +1 514 555 0100" }] };
    const payload = safePayload(leaked);
    assert.match(payload.subject, /^\[TradeCatch RESOLVED\]/);
    assert.ok(!payload.lines.some((l) => l.label === "Contact"), "the unsafe line is dropped");
    assert.ok(payload.lines.some((l) => l.label === "Service"));
    assert.ok(payload.lines.some((l) => l.label === "Resolved"));
  });
});

describe("an outage recorded after the fact (the database could not store it while it was down)", () => {
  const outage = (over: Record<string, unknown> = {}) => ({
    fingerprint: "database:unavailable",
    service: "database",
    category: "unavailable",
    priority: "critical" as const,
    title: "Database was unavailable",
    summary: "No successful monitor run for 9 minutes.",
    correlationId: "dbdown_1",
    startedAt: new Date(START - 9 * MIN).toISOString(),
    ...over,
  });

  it("stores one resolved critical incident spanning the outage and tells administrators it recovered", async () => {
    const { engine, store } = harness();
    const incident = await engine.recordPastOutage(outage());
    assert.equal(incident.priority, "critical");
    assert.equal(incidentState(incident.status), "resolved");
    assert.equal(incident.firstSeenAt, new Date(START - 9 * MIN).toISOString());
    assert.equal(incident.resolvedAt, new Date(START).toISOString());
    assert.equal(incident.resolvedBy, "auto");
    const kinds = (await store.listIncidentEvents(incident.id)).map((e) => e.kind);
    assert.deepEqual(kinds.sort(), ["opened", "resolved"]);
    assert.deepEqual((await store.listAlertDeliveries()).map((a) => a.kind), ["recovered"], "the down alert already went out by email; only recovery remains");
  });

  it("is safe to repeat for the same outage", async () => {
    const { engine, store } = harness();
    await engine.recordPastOutage(outage());
    await engine.recordPastOutage(outage());
    assert.equal((await store.listIncidents()).length, 1);
    assert.equal((await store.listAlertDeliveries()).length, 1);
  });

  it("does not alert for a simulated outage", async () => {
    const { engine, store } = harness();
    await engine.recordPastOutage(outage({ simulated: true }));
    assert.equal((await store.listAlertDeliveries()).length, 0);
  });
});

describe("alert storm prevention", () => {
  it("caps individual alerts during a widespread outage and sends one digest", async () => {
    const { engine, store, thresholds } = harness();
    for (let i = 0; i < 15; i += 1)
      await engine.report(report({ fingerprint: `svc${i}:failure`, service: `svc${i}`, priority: "high" }));
    const alerts = await store.listAlertDeliveries();
    assert.equal(alerts.filter((a) => a.kind === "opened").length, thresholds.alerts.storm.maxAlerts);
    assert.equal(alerts.filter((a) => a.kind === "digest").length, 1);
    assert.equal((await store.listIncidents()).length, 15, "every incident is still recorded");
  });

  it("never suppresses a critical alert", async () => {
    const { engine, store, thresholds } = harness();
    for (let i = 0; i < thresholds.alerts.storm.maxAlerts + 2; i += 1)
      await engine.report(report({ fingerprint: `svc${i}:failure`, service: `svc${i}`, priority: "high" }));
    await engine.report(report({ fingerprint: "website:unavailable:page", service: "website", priority: "critical" }));
    assert.ok((await store.listAlertDeliveries()).some((a) => a.kind === "opened" && a.priority === "critical"));
  });

  it("alerts for a storm-suppressed incident once the window has passed and it is still firing", async () => {
    const { engine, store, advance, thresholds } = harness();
    for (let i = 0; i < thresholds.alerts.storm.maxAlerts + 1; i += 1)
      await engine.report(report({ fingerprint: `svc${i}:failure`, service: `svc${i}`, priority: "high" }));
    const suppressed = thresholds.alerts.storm.maxAlerts;
    advance(thresholds.alerts.storm.windowMs + MIN);
    await engine.report(report({ fingerprint: `svc${suppressed}:failure`, service: `svc${suppressed}`, priority: "high" }));
    const incident = (await store.listIncidents()).find((i) => i.fingerprint === `svc${suppressed}:failure`)!;
    assert.ok(incident.lastAlertedAt, "gets its own alert after the storm");
  });

  it("sends nothing for simulated incidents", async () => {
    const { engine, store } = harness();
    await engine.report(report({ simulated: true }));
    assert.equal((await store.listIncidents()).length, 1);
    assert.equal((await store.listAlertDeliveries()).length, 0);
  });
});

describe("MON-12 alert delivery failure is recorded and retried safely", () => {
  async function queued() {
    const h = harness();
    await h.engine.report(report());
    return h;
  }
  const deliver = (h: Awaited<ReturnType<typeof queued>>, notify: (p: AlertPayload) => Promise<void>) =>
    deliverDueAlerts({ store: h.store, notify, now: h.now, thresholds: h.thresholds, siteUrl: "https://example.test" });

  it("records the failure with a safe code, backs off, and succeeds on a later run", async () => {
    const h = await queued();
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("smtp password=hunter2 refused for owner@example.com");
    };
    const first = await deliver(h, flaky);
    assert.deepEqual([first.sent, first.failed], [0, 1]);
    const [row] = await h.store.listAlertDeliveries({ failedOnly: true });
    assert.equal(row.attempts, 1);
    assert.equal(row.status, "pending");
    assert.equal(row.lastError, "send_failed");
    assert.equal(JSON.stringify(row).includes("hunter2"), false);
    await deliver(h, flaky);
    assert.equal(calls, 1, "not retried before its backoff has passed");
    h.advance(DEFAULT_THRESHOLDS.alerts.retry.backoffMs[0] + 1);
    const second = await deliver(h, flaky);
    assert.equal(second.sent, 1);
    assert.equal((await h.store.listAlertDeliveries())[0].status, "sent");
  });

  it("gives up after the bounded number of attempts and says so", async () => {
    const h = await queued();
    const always = async () => {
      throw new Error("down");
    };
    for (let i = 0; i < DEFAULT_THRESHOLDS.alerts.retry.maxAttempts + 3; i += 1) {
      await deliver(h, always);
      h.advance(2 * 60 * MIN);
    }
    const [row] = await h.store.listAlertDeliveries();
    assert.equal(row.status, "exhausted");
    assert.equal(row.attempts, DEFAULT_THRESHOLDS.alerts.retry.maxAttempts);
    assert.equal((await h.store.alertSummary(h.now().toISOString())).exhausted, 1);
    const incident = (await h.store.listIncidents())[0];
    assert.ok((await h.store.listIncidentEvents(incident.id)).some((e) => e.kind === "admin_notification_exhausted"));
  });

  it("a notifier that hangs is cut off by the timeout instead of blocking the run", async () => {
    const h = await queued();
    const quick = { ...h.thresholds, alerts: { ...h.thresholds.alerts, retry: { ...h.thresholds.alerts.retry, sendTimeoutMs: 20 } } };
    const result = await deliverDueAlerts({
      store: h.store,
      notify: () => new Promise(() => undefined),
      now: h.now,
      thresholds: quick,
      siteUrl: "https://example.test",
    });
    assert.equal(result.failed, 1);
    assert.equal((await h.store.listAlertDeliveries({ failedOnly: true }))[0].lastError, "timeout");
  });

  it("two overlapping runs never send the same alert twice", async () => {
    const h = await queued();
    let sent = 0;
    const slow = async () => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
    };
    await Promise.all([deliver(h, slow), deliver(h, slow)]);
    assert.equal(sent, 1);
  });
});

describe("MON-15 alert payloads carry no sensitive information", () => {
  it("contains the required context and no secrets, even if a summary was polluted", async () => {
    const h = harness();
    await h.engine.report(
      report({
        organizationId: "org_123",
        summary: "Failed for owner@example.com with Bearer abc123 sk_live_abcdef card 4242 4242 4242 4242 +1 604 555 0199",
      }),
    );
    const incident = (await h.store.listIncidents())[0];
    const payload = composeAlert("opened", incident, { now: h.now(), siteUrl: "https://example.test" });
    const text = JSON.stringify(payload);
    for (const secret of ["owner@example.com", "abc123", "sk_live", "4242", "555 0199"]) assert.equal(text.includes(secret), false, secret);
    const labels = payload.lines.map((line) => line.label);
    for (const required of ["Service", "Severity", "Category", "Business", "First seen", "Diagnostic reference"])
      assert.ok(labels.includes(required), `${required} missing`);
    assert.equal(payload.lines.find((l) => l.label === "Business")?.value, "org_123");
    assert.equal(payload.lines.find((l) => l.label === "Diagnostic reference")?.value, incident.id);
    assert.match(payload.subject, /^\[TradeCatch HIGH\]/);
    assert.equal(payload.ctaUrl, `https://example.test/admin/system-health?incident=${incident.id}`);
  });

  it("falls back to a minimal payload when a field slips past composition with something unsafe", () => {
    const composed: AlertPayload = {
      kind: "opened",
      priority: "high",
      severity: "high",
      title: "Stripe webhooks are failing",
      subject: "[TradeCatch HIGH] Stripe webhooks are failing",
      lines: [
        { label: "Service", value: "Stripe payments" },
        { label: "Severity", value: "HIGH" },
        { label: "Diagnostic reference", value: "inc_1" },
        { label: "Extra", value: "contact owner@example.com about sk_live_abcdef123456" },
      ],
      incidentId: "inc_1",
      simulated: false,
      idempotencyKey: "k",
    };
    const sent = safePayload(composed);
    const text = JSON.stringify(sent);
    assert.equal(text.includes("owner@example.com"), false);
    assert.equal(text.includes("sk_live"), false);
    assert.ok(sent.lines.some((line) => line.label === "Diagnostic reference"));
    assert.equal(safePayload({ ...composed, lines: composed.lines.slice(0, 3) }).title, composed.title, "clean payloads are untouched");
  });

  it("delivers the final payload through the notifier with a per-attempt idempotency key", async () => {
    const h = harness();
    await h.engine.report(report({ summary: "token=0123456789abcdef0123456789abcdef leaked" }));
    const seen: AlertPayload[] = [];
    await deliverDueAlerts({
      store: h.store,
      notify: async (p) => void seen.push(p),
      now: h.now,
      thresholds: h.thresholds,
      siteUrl: "https://example.test",
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].idempotencyKey, /^tc-alert-alert_.+-1$/);
    assert.equal(JSON.stringify(seen[0]).includes("0123456789abcdef"), false);
  });
});
