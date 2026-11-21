import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { incidentFingerprint } from "../../src/product/reliability/fingerprint";
import {
  evaluateApiTraffic,
  evaluateSignals,
  evaluateWebsite,
  emptySignals,
  evaluateDatabaseSlow,
  p95FromBuckets,
  type ProbeSample,
  type TrafficBucket,
} from "../../src/product/reliability/rules";
import {
  DEFAULT_THRESHOLDS,
  resolveThresholds,
} from "../../src/product/reliability/thresholds";
import { redactDiagnostic } from "../../src/product/reliability/types";
import {
  UnsafeAlertPayloadError,
  assertAlertSafe,
  sanitizeAlertText,
} from "../../src/product/reliability/sanitize";

const NOW = new Date("2026-11-20T15:00:00.000Z");
const T = DEFAULT_THRESHOLDS;
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

function bucket(minutes: number, over: Partial<TrafficBucket> = {}): TrafficBucket {
  return {
    at: minutesAgo(minutes),
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
  };
}

function probe(minutes: number, ok: boolean, target = "page"): ProbeSample {
  return { at: minutesAgo(minutes), target, ok, statusCode: ok ? 200 : 503, durationMs: 120 };
}

describe("incident fingerprint", () => {
  it("is stable across request ids, counters and casing", () => {
    const a = incidentFingerprint({ service: "stripe", operation: "webhook.invoice.paid", code: "sync_failed" });
    const b = incidentFingerprint({ service: "Stripe", operation: "webhook.invoice.paid", code: "SYNC_FAILED" });
    assert.equal(a, b);
    const withIds = incidentFingerprint({
      service: "ai_receptionist",
      operation: "call_status_record 8f14e45f-ceea-467a-9575-8a7c1f9b9d3a",
      code: "E123456",
    });
    const withOtherIds = incidentFingerprint({
      service: "ai_receptionist",
      operation: "call_status_record 11111111-2222-4333-8444-555555555555",
      code: "E654321",
    });
    assert.equal(withIds, withOtherIds);
  });

  it("separates different failures and never embeds a business identifier", () => {
    const a = incidentFingerprint({ service: "stripe", code: "sync_failed" });
    const b = incidentFingerprint({ service: "stripe", code: "invalid_signature" });
    assert.notEqual(a, b);
    assert.ok(a.length <= 160);
    assert.match(a, /^[a-z0-9_.:#-]+$/);
  });
});

describe("thresholds", () => {
  it("ships defaults and lets the environment tune them within safe bounds", () => {
    assert.equal(resolveThresholds({}).website.consecutiveFailures, 3);
    const tuned = resolveThresholds({
      MONITOR_THRESHOLDS_JSON: JSON.stringify({ website: { consecutiveFailures: 5 }, api: { critical: { errorRate: 0.7 } } }),
    });
    assert.equal(tuned.website.consecutiveFailures, 5);
    assert.equal(tuned.api.critical.errorRate, 0.7);
    assert.equal(tuned.api.critical.minRequests, DEFAULT_THRESHOLDS.api.critical.minRequests);
  });

  it("keeps a duration override in milliseconds even when it sits under a group (cooldowns, reminders, quiet periods)", () => {
    const HOUR = 60 * 60_000;
    const tuned = resolveThresholds({
      MONITOR_THRESHOLDS_JSON: JSON.stringify({
        alerts: { cooldownMs: { critical: 20 * 60_000, warning: 2 * HOUR }, reminderMs: { critical: 12 * HOUR } },
        errors: { quietMs: { high: 25 * 60_000 } },
      }),
    });
    assert.equal(tuned.alerts.cooldownMs.critical, 20 * 60_000);
    assert.equal(tuned.alerts.cooldownMs.warning, 2 * HOUR);
    assert.equal(tuned.alerts.reminderMs.critical, 12 * HOUR);
    assert.equal(tuned.errors.quietMs.high, 25 * 60_000);
    // Untouched siblings keep their defaults.
    assert.equal(tuned.alerts.cooldownMs.high, DEFAULT_THRESHOLDS.alerts.cooldownMs.high);
    // And a duration is still kept within sane bounds (at least one second, at most two weeks).
    const bounded = resolveThresholds({
      MONITOR_THRESHOLDS_JSON: JSON.stringify({ alerts: { cooldownMs: { critical: 5 }, reminderMs: { critical: 99 * 24 * HOUR } } }),
    });
    assert.equal(bounded.alerts.cooldownMs.critical, 1_000);
    assert.equal(bounded.alerts.reminderMs.critical, 14 * 24 * HOUR);
  });

  it("ignores malformed or out-of-range overrides instead of disabling monitoring", () => {
    assert.deepEqual(resolveThresholds({ MONITOR_THRESHOLDS_JSON: "{nope" }), DEFAULT_THRESHOLDS);
    const clamped = resolveThresholds({
      MONITOR_THRESHOLDS_JSON: JSON.stringify({ website: { consecutiveFailures: 0 }, api: { critical: { errorRate: 7 } } }),
    });
    assert.ok(clamped.website.consecutiveFailures >= 1);
    assert.ok(clamped.api.critical.errorRate <= 1);
  });
});

describe("MON-01 website availability", () => {
  it("raises a critical finding only after consecutive failed probes", () => {
    assert.equal(evaluateWebsite([probe(1, false), probe(2, true)], T).length, 0);
    const down = evaluateWebsite([probe(1, false), probe(2, false), probe(3, false), probe(4, true)], T);
    assert.equal(down.length, 1);
    assert.equal(down[0].priority, "critical");
    assert.equal(down[0].service, "website");
    assert.equal(down[0].fingerprint, "website:unavailable:page");
  });

  it("treats a single recovered probe as a break in the run and stays quiet when data is missing", () => {
    assert.equal(evaluateWebsite([probe(1, true), probe(2, false), probe(3, false), probe(4, false)], T).length, 0);
    assert.equal(evaluateWebsite([], T).length, 0);
  });

  it("evaluates each target on its own", () => {
    const samples = [
      ...[1, 2, 3].map((m) => probe(m, false, "api")),
      ...[1, 2, 3].map((m) => probe(m, true, "page")),
    ];
    const findings = evaluateWebsite(samples, T);
    assert.deepEqual(findings.map((f) => f.fingerprint), ["website:unavailable:api"]);
  });
});

describe("API traffic rules", () => {
  it("MON-02: a high server-error rate over enough requests raises an alert", () => {
    const buckets = [1, 2, 3].map((m) => bucket(m, { total: 40, s2xx: 10, s5xx: 30 }));
    const findings = evaluateApiTraffic(buckets, NOW, T);
    const widespread = findings.find((f) => f.fingerprint === "api:error_rate:critical");
    assert.ok(widespread);
    assert.equal(widespread.priority, "critical");
  });

  it("raises only a warning for an elevated but not widespread error rate", () => {
    const buckets = Array.from({ length: 8 }, (_, i) => bucket(i + 1, { total: 40, s2xx: 34, s5xx: 6 }));
    const findings = evaluateApiTraffic(buckets, NOW, T);
    assert.equal(findings.some((f) => f.priority === "critical"), false);
    assert.equal(findings.find((f) => f.fingerprint === "api:error_rate:elevated")?.priority, "warning");
  });

  it("does not alert on a handful of failures out of very little traffic", () => {
    const findings = evaluateApiTraffic([bucket(1, { total: 4, s5xx: 4 })], NOW, T);
    assert.deepEqual(findings, []);
  });

  it("MON-03: isolated 403 and 429 responses do not alert", () => {
    const buckets = [bucket(1, { total: 300, s2xx: 287, s403: 6, s429: 7 }), bucket(2, { total: 300, s2xx: 295, s401: 5 })];
    assert.deepEqual(evaluateApiTraffic(buckets, NOW, T), []);
  });

  it("a real spike in 403/401 or 429 responses raises a warning", () => {
    const attack = Array.from({ length: 5 }, (_, i) => bucket(i + 1, { total: 100, s2xx: 30, s403: 40, s401: 20, s429: 10 }));
    const findings = evaluateApiTraffic(attack, NOW, T);
    assert.ok(findings.some((f) => f.fingerprint === "api:auth_failures"));
    const throttled = Array.from({ length: 5 }, (_, i) => bucket(i + 1, { total: 200, s2xx: 150, s429: 50 }));
    assert.ok(evaluateApiTraffic(throttled, NOW, T).some((f) => f.fingerprint === "api:rate_limited"));
  });

  it("ignores buckets outside the monitoring window", () => {
    const old = bucket(120, { total: 500, s5xx: 500 });
    assert.deepEqual(evaluateApiTraffic([old], NOW, T), []);
  });

  it("flags abnormal latency and estimates p95 from the histogram", () => {
    const slow = Array.from({ length: 5 }, (_, i) => bucket(i + 1, { total: 20, s2xx: 20, lat: [0, 0, 0, 2, 4, 6, 8] }));
    assert.ok(evaluateApiTraffic(slow, NOW, T).some((f) => f.fingerprint === "api:latency"));
    assert.equal(p95FromBuckets([bucket(1, { total: 100, lat: [96, 4, 0, 0, 0, 0, 0] })]).upperMs, 100);
    assert.equal(p95FromBuckets([]).upperMs, 0);
  });
});

describe("signal rules", () => {
  it("MON-05: normal caller hang-ups never count as call failures", () => {
    const signals = emptySignals();
    signals.calls = { staleUnfinalized: 0, failedSessions: 0, totalSessions: 60, hungUpSessions: 40 };
    assert.deepEqual(evaluateSignals(signals, T), []);
  });

  it("MON-04: genuine call failures and calls with no final status are high priority", () => {
    const signals = emptySignals();
    signals.calls = { staleUnfinalized: 4, failedSessions: 5, totalSessions: 12, hungUpSessions: 2 };
    const findings = evaluateSignals(signals, T);
    assert.ok(findings.some((f) => f.fingerprint === "receptionist:calls_failed" && f.priority === "high"));
    assert.ok(findings.some((f) => f.fingerprint === "receptionist:calls_without_final_status" && f.priority === "high"));
  });

  it("MON-06: repeated SMS delivery failures are detected, an isolated one is not", () => {
    const isolated = emptySignals();
    isolated.sms = { failed: 1, total: 30 };
    assert.deepEqual(evaluateSignals(isolated, T), []);
    const broken = emptySignals();
    broken.sms = { failed: 9, total: 20 };
    const findings = evaluateSignals(broken, T);
    assert.equal(findings.find((f) => f.fingerprint === "sms:delivery_failures")?.priority, "warning");
    const down = emptySignals();
    down.sms = { failed: 40, total: 50 };
    assert.equal(evaluateSignals(down, T).find((f) => f.fingerprint === "sms:delivery_failures")?.priority, "high");
  });

  it("MON-07: revoked or expired calendar credentials are detected with the businesses affected", () => {
    const signals = emptySignals();
    signals.calendar = { credentialProblemBusinesses: ["biz-1", "biz-2", "biz-3"], failedSyncs: 0 };
    const finding = evaluateSignals(signals, T).find((f) => f.service === "google_calendar");
    assert.ok(finding);
    assert.equal(finding.priority, "warning");
    assert.equal(finding.affectedBusinesses, 3);
    assert.equal(finding.organizationId, undefined);
    const single = emptySignals();
    single.calendar = { credentialProblemBusinesses: ["biz-9"], failedSyncs: 0 };
    assert.equal(evaluateSignals(single, T).find((f) => f.service === "google_calendar")?.organizationId, "biz-9");
  });

  it("stuck jobs, duplicate executions and exhausted retries are reported as automation problems", () => {
    const signals = emptySignals();
    signals.automations = { stuckJobs: 7, duplicateExecutions: 2, retryExhausted: 4 };
    const findings = evaluateSignals(signals, T);
    assert.equal(findings.find((f) => f.fingerprint === "automations:stuck_jobs")?.priority, "warning");
    assert.equal(findings.find((f) => f.fingerprint === "automations:duplicate_execution")?.priority, "high");
    assert.equal(findings.find((f) => f.fingerprint === "automations:retry_exhausted")?.priority, "warning");
  });

  it("MON-08: repeated Stripe webhook failures and inconsistent billing are high priority", () => {
    const signals = emptySignals();
    signals.stripe = { webhookFailures: 3, signatureFailures: 2, inconsistentBilling: 0 };
    assert.equal(evaluateSignals(signals, T).find((f) => f.fingerprint === "stripe:webhook_failures")?.priority, "high");
    const billing = emptySignals();
    billing.stripe = { webhookFailures: 0, signatureFailures: 0, inconsistentBilling: 2 };
    assert.equal(evaluateSignals(billing, T).find((f) => f.fingerprint === "stripe:billing_inconsistent")?.priority, "high");
    const noise = emptySignals();
    noise.stripe = { webhookFailures: 1, signatureFailures: 4, inconsistentBilling: 0 };
    assert.deepEqual(evaluateSignals(noise, T), []);
  });

  it("no data means no findings: an empty system is not an incident", () => {
    assert.deepEqual(evaluateSignals(emptySignals(), T), []);
  });
});

describe("database slowness", () => {
  const dbProbe = (minutes: number, durationMs: number, ok = true): ProbeSample => ({
    at: minutesAgo(minutes),
    target: "database",
    ok,
    durationMs,
  });
  const slow = (n: number) => Array.from({ length: n }, (_, i) => dbProbe(i, T.database.slowMs + 200));

  it("raises a warning only after several slow checks in a row", () => {
    assert.deepEqual(evaluateDatabaseSlow(slow(T.database.slowConsecutive - 1), T), []);
    const [finding] = evaluateDatabaseSlow(slow(T.database.slowConsecutive), T);
    assert.equal(finding.fingerprint, "database:slow");
    assert.equal(finding.priority, "warning");
    assert.equal(finding.service, "database");
  });

  it("one fast check in the run clears it, and other probe targets are ignored", () => {
    const samples = [...slow(T.database.slowConsecutive)];
    samples[2] = dbProbe(2, 40);
    assert.deepEqual(evaluateDatabaseSlow(samples, T), []);
    assert.deepEqual(
      evaluateDatabaseSlow(slow(T.database.slowConsecutive).map((s) => ({ ...s, target: "page" })), T),
      [],
    );
  });

  it("a failed check is not 'slow': availability is a different, critical path", () => {
    assert.deepEqual(
      evaluateDatabaseSlow(Array.from({ length: 6 }, (_, i) => dbProbe(i, 9000, false)), T),
      [],
    );
  });
});

describe("alert text safety", () => {
  it("MON-15: removes credentials, payment data, contact details and tokens", () => {
    const dirty = [
      "Bearer abc.def.ghi",
      "sk_live_51Habcdef",
      "whsec_topsecret",
      "postgres://user:hunter2@db.example.com:5432/app", // secret-scan: allow
      "card 4242 4242 4242 4242",
      "owner@example.com called +1 604 555 0199",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      "token=0123456789abcdef0123456789abcdef",
    ].join(" | ");
    const clean = sanitizeAlertText(dirty, 1000);
    for (const secret of ["abc.def.ghi", "sk_live", "topsecret", "hunter2", "4242", "owner@example.com", "555 0199", "eyJhbGci", "0123456789abcdef0123456789abcdef"]) {
      assert.equal(clean.includes(secret), false, `${secret} survived`);
    }
  });

  it("MON-15: a recorded error's stored detail is scrubbed of contact details too, not just secrets", () => {
    const stored = redactDiagnostic("failed for owner@example.com +1 604 555 0199 card 4242 4242 4242 4242 sk_live_abcdef123456 Bearer abc.def.ghi postgres://u:hunter2@db.internal/app"); // secret-scan: allow
    for (const secret of ["owner@example.com", "555 0199", "4242", "sk_live_abcdef", "abc.def.ghi", "hunter2"])
      assert.equal(stored.includes(secret), false, secret + " survived");
    assert.ok(stored.length <= 300);
  });

  it("bounds length and refuses to render an unsafe payload", () => {
    assert.equal(sanitizeAlertText("x".repeat(500), 80).length <= 80, true);
    assert.doesNotThrow(() => assertAlertSafe({ title: "database unavailable", ref: "inc_abc123" }));
    assert.throws(() => assertAlertSafe({ title: "failed for owner@example.com" }), UnsafeAlertPayloadError);
    assert.throws(() => assertAlertSafe({ detail: "sk_live_abcdef123456" }), UnsafeAlertPayloadError);
  });
});
