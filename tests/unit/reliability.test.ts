import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactDiagnostic } from "../../src/product/reliability/types";
import { createMemoryReliabilityStore } from "../../src/product/reliability/store";
import { createReliabilityService, type Probe } from "../../src/product/reliability/service";

const NOW = new Date("2026-10-16T18:30:00.000Z");

function service(probes: Probe[], notify?: (input: { simulated: boolean }) => Promise<void>) {
  return createReliabilityService({
    store: createMemoryReliabilityStore(),
    now: () => NOW,
    environment: () => "staging",
    probe: async () => probes,
    notifyAdmin: notify,
    version: () => "0.1.0",
  });
}

const healthy: Probe[] = [
  { service: "api", status: "healthy" },
  { service: "database", status: "healthy" },
  { service: "jobs", status: "healthy" },
  { service: "google_calendar", status: "unavailable", detail: "disconnected" },
];

describe("reliability", () => {
  it("keeps the platform available when only an optional integration fails", async () => {
    const overview = await service(healthy).overview();
    assert.equal(overview.overall, "healthy");
    assert.equal(overview.services.find((row) => row.service === "google_calendar")?.status, "unavailable");
  });

  it("marks the platform unavailable when the database cannot answer", async () => {
    const overview = await service([
      { service: "api", status: "healthy" },
      { service: "database", status: "unavailable" },
      { service: "jobs", status: "healthy" },
    ]).overview();
    assert.equal(overview.overall, "unavailable");
  });

  it("records a correlated error without secrets and opens one incident for repeats", async () => {
    const monitor = service(healthy);
    const first = await monitor.recordError({
      organizationId: "biz-a",
      service: "ai_receptionist",
      operation: "generate_response",
      errorCode: "AI_PROVIDER_TIMEOUT",
      severity: "high",
      retryable: true,
      detail: "timeout Bearer sk_live_secretvalue",
      requestId: "req_1024",
      simulated: true,
    });
    await monitor.recordError({ service: "ai_receptionist", operation: "generate_response", errorCode: "AI_PROVIDER_TIMEOUT", severity: "high", retryable: true, requestId: "req_1024", simulated: true });
    await monitor.recordError({ service: "ai_receptionist", operation: "generate_response", errorCode: "AI_PROVIDER_TIMEOUT", severity: "high", retryable: true, requestId: "req_1024", simulated: true });
    assert.equal(first.requestId, "req_1024");
    assert.equal(first.detail?.includes("sk_live"), false);
    assert.match(first.detail || "", /\[redacted\]/);
    const incidents = await monitor.listIncidents();
    assert.equal(incidents.length, 1);
    const other = await monitor.listErrors({ organizationId: "biz-b" });
    assert.equal(other.length, 0);
  });

  it("refuses an unsafe retry and does not send a second customer message", async () => {
    const monitor = service(healthy);
    const operation = await monitor.recordFailedOperation({
      service: "jobs",
      operation: "quote_reminder",
      idempotencyKey: "quote-1",
      retryable: false,
      error: "customer opted out",
      simulated: true,
    });
    await assert.rejects(() => monitor.retryOperation(operation.id, "admin"), /cannot be retried/);
  });

  it("records estimated cost without calling a provider", async () => {
    let notifications = 0;
    const previous = process.env.RELIABILITY_BUDGET_CENTS;
    process.env.RELIABILITY_BUDGET_CENTS = "1000";
    const monitor = service(healthy, async (input) => {
      notifications += 1;
      assert.equal(input.simulated, true);
    });
    const cost = await monitor.recordUsage({ service: "sms", units: 200, centsPerUnit: 4, simulated: true });
    process.env.RELIABILITY_BUDGET_CENTS = previous;
    assert.equal(cost.confirmed, false);
    assert.equal(cost.estimatedCents, 800);
    assert.equal(notifications, 1);
    const summary = await monitor.costs();
    assert.equal(summary.estimated, true);
    assert.equal(summary.confirmed, false);
  });

  it("does not claim a database write succeeded", () => {
    const result = service(healthy).databaseResult(false, { saved: true });
    assert.equal(result.ok, false);
  });

  it("redacts payment-like numbers", () => {
    assert.equal(redactDiagnostic("card 4242424242424242").includes("4242"), false);
  });
});
