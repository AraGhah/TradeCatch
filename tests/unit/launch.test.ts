import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLaunchReadiness } from "../../src/product/launch/readiness";
import { createMemoryLaunchStore } from "../../src/product/launch/store";
import { createLaunchService } from "../../src/product/launch/service";

const production = {
  NODE_ENV: "production",
  TRADECATCH_ENV: "production",
  AUTH_SECRET: "secret",
  DATABASE_URL: "postgres://prod.example/tradecatch",
  NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca",
  ANTHROPIC_API_KEY: "present",
  TWILIO_ACCOUNT_SID: "AC",
  TWILIO_AUTH_TOKEN: "token",
  STRIPE_SECRET_KEY: "sk_live_example",
  LAUNCH_AI_VERIFIED: "1",
  LAUNCH_PHONE_VERIFIED: "1",
  LAUNCH_STRIPE_VERIFIED: "1",
  ADMIN_ALERT_EMAIL: "ops@tradecatch.ca",
} as NodeJS.ProcessEnv;

describe("launch and pilot", () => {
  it("does not treat staging evidence as production readiness", () => {
    const staging = evaluateLaunchReadiness({ ...production, TRADECATCH_ENV: "staging", NODE_ENV: "production" }, { ok: true });
    assert.equal(staging.checks.find((check) => check.component === "phone")?.status, "needs_attention");
    assert.notEqual(staging.overall, "ready");
    const demo = evaluateLaunchReadiness({ ...production, NEXT_PUBLIC_DEMO_MODE: "1" }, { ok: true });
    assert.equal(demo.checks.find((check) => check.component === "security")?.status, "failed");
    const testKey = evaluateLaunchReadiness({ ...production, STRIPE_SECRET_KEY: "sk_test_example" }, { ok: true });
    assert.equal(testKey.checks.find((check) => check.component === "stripe")?.status, "failed");
  });

  it("keeps a live pilot paused until authorized tests and readiness pass", async () => {
    const service = createLaunchService({ store: createMemoryLaunchStore(), now: () => new Date("2026-10-16T12:00:00.000Z") });
    await assert.rejects(() => service.createPilot({
      organizationId: "demo-org",
      businessName: "Demo Plumbing",
      contactName: "Demo",
      contactEmail: "demo@example.com",
      accountType: "demo",
    }), /demo/);
    const pilot = await service.createPilot({
      organizationId: "live-org",
      businessName: "Montreal Plumbing Pro",
      industry: "plumbing",
      contactName: "Owner",
      contactEmail: "owner@example.com",
      phoneE164: "+15145550100",
      accountType: "live",
    });
    const tests = await service.tests(pilot.id);
    assert.equal(tests.every((test) => test.status === "pending"), true);
    await assert.rejects(() => service.activate(pilot.id, "ready"), /live call/);
    await service.recordTest(pilot.id, "customer_calls", "passed");
    await service.recordTest(pilot.id, "ai_fallback", "passed");
    await assert.rejects(() => service.activate(pilot.id, "needs_attention"), /not ready/);
    const active = await service.activate(pilot.id, "ready");
    assert.equal(active.pilotStatus, "active");
    assert.equal((await service.recordEvent("live-org", "lead")).recorded, true);
    assert.equal((await service.recordEvent("demo-org", "lead")).recorded, false);
    const report = await service.report(pilot.id);
    assert.equal(report.attributedRevenue, null);
    assert.equal(report.activity.leads, 1);
    assert.equal(report.activity.includesDemoData, false);
    const feedback = await service.addFeedback({ organizationId: "live-org", category: "ai", description: "Offered an unknown service", priority: "high" });
    const other = await service.feedback("other-org");
    assert.equal(other.some((row) => row.id === feedback.id), false);
    const left = await service.leave(pilot.id);
    assert.equal(left.aiStatus, "inactive");
    assert.equal(left.pilotStatus, "completed");
  });
});
