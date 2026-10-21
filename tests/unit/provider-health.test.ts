import assert from "node:assert/strict";
import { test } from "node:test";
import { providerProbes } from "../../src/product/reliability/probes";
import {
  JOB_MAX_AGE_MS,
  scheduledJobFailures,
} from "../../src/product/reliability/job-health";
import { createReliabilityService } from "../../src/product/reliability/service";
import { createMemoryReliabilityStore } from "../../src/product/reliability/store";

const sid = `AC${"a".repeat(32)}`;
const env = {
  TWILIO_ACCOUNT_SID: sid,
  TWILIO_AUTH_TOKEN: "private-token",
  STRIPE_SECRET_KEY: "sk_live_fake",
  ANTHROPIC_API_KEY: "private-ai-key",
};
test("provider credentials never establish operational or delivery-verified health", async () => {
  const calls: string[] = [];
  const probes = await providerProbes(env, async (input) => {
    const url = String(input);
    calls.push(url);
    return Response.json(
      url.includes("twilio")
        ? { sid, status: "active" }
        : url.includes("stripe")
          ? { object: "account", id: "acct_test", charges_enabled: true }
          : { data: [{ id: "test-model" }] },
    );
  });
  assert.equal(calls.length, 3);
  assert.ok(
    probes.every((p) => p.state === "connected" && p.status === "unknown"),
  );
  assert.ok(
    calls.every((url) => !url.includes("private") && !url.includes("sk_live")),
  );
  const off = await providerProbes(
    { STRIPE_TEST_SECRET_KEY: "sk_test_fake" },
    async () => {
      throw Error("Must not call real provider");
    },
  );
  assert.ok(off.every((p) => p.state === "unconfigured"));
});
test("provider failures, timeouts and invalid responses cannot become green or leak diagnostics", async () => {
  for (const response of [
    () => Response.json({ secret: "private-token" }, { status: 401 }),
    () => Response.json({}),
    () => {
      throw Error("Bearer private-token");
    },
  ]) {
    const probes = await providerProbes(env, async () => response());
    assert.ok(
      probes.every(
        (p) => p.status === "unavailable" || p.status === "degraded",
      ),
    );
    assert.ok(!JSON.stringify(probes).includes("private-token"));
  }
});
test("every scheduled job needs its own recent successful result", () => {
  const now = Date.now();
  const rows = Object.keys(JOB_MAX_AGE_MS).map((path) => ({
    service: `job:${path}`,
    status: "healthy",
    checkedAt: new Date(now).toISOString(),
  }));
  assert.deepEqual(scheduledJobFailures(rows, now), []);
  rows[0].status = "unavailable";
  rows[1].checkedAt = new Date(now - 60 * 60_000).toISOString();
  assert.equal(scheduledJobFailures(rows, now).length, 2);
  assert.equal(
    scheduledJobFailures(
      [
        {
          service: "scheduler_tick",
          status: "healthy",
          checkedAt: new Date(now).toISOString(),
        },
      ],
      now,
    ).length,
    Object.keys(JOB_MAX_AGE_MS).length,
  );
});
test("health failure alerts persist, retry after failure and do not resend a successful alert", async () => {
  const store = createMemoryReliabilityStore();
  let now = new Date(),
    sends = 0,
    fail = true;
  const service = createReliabilityService({
    store,
    now: () => now,
    environment: () => "production",
    probe: async () => [
      { service: "jobs", status: "degraded", state: "configured" },
    ],
    notifyAdmin: async () => {
      sends++;
      if (fail) throw Error("unavailable");
    },
  });
  await service.overview();
  assert.equal(sends, 0, "a read-only dashboard does not send alerts");
  await service.overview({ notifyOnFailure: true });
  assert.equal(sends, 1);
  await service.overview({ notifyOnFailure: true });
  assert.equal(sends, 1);
  fail = false;
  now = new Date(now.getTime() + 6 * 60_000);
  await service.overview({ notifyOnFailure: true });
  assert.equal(sends, 2);
  await service.overview({ notifyOnFailure: true });
  assert.equal(sends, 2);
  assert.equal((await store.listIncidents()).length, 1);
});

test("configured-only health cannot be green and legacy simulation incidents are not retried", async () => {
  const store = createMemoryReliabilityStore();
  let sends = 0;
  await store.saveIncident({
    id: "legacy",
    service: "simulated_provider",
    severity: "high",
    title: "Old simulation",
    status: "open",
    correlationId: "simulation",
    createdAt: new Date().toISOString(),
  });
  const service = createReliabilityService({
    store,
    now: () => new Date(),
    environment: () => "production",
    probe: async () => [
      { service: "twilio_sms", status: "healthy", state: "configured" },
    ],
    notifyAdmin: async () => {
      sends++;
    },
  });
  const result = await service.overview({ notifyOnFailure: true });
  assert.equal(result.services[0].status, "unknown");
  assert.equal(sends, 0);
});
