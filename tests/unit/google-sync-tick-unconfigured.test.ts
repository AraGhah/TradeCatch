import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { runGoogleSyncTick } from "../../src/product/scheduling/runtime";

/**
 * 2026-11-22 → 2026-11-26: /api/calendar/google/tick failed on every
 * per-minute cron run in production (the Google Calendar sync tables are
 * missing from that database) although no Google client credentials are set,
 * so no business could be connected and the pass had no work. Each failure
 * failed the whole cron run. See docs/INCIDENT-2026-11-25-RECURRING-OUTAGES.md.
 */
const KEYS = ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("Google Calendar per-minute pass", () => {
  it("returns without doing any work when Google Calendar is not configured", async () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const result = await runGoogleSyncTick();
    assert.equal("skipped" in result && result.skipped, "not_configured");
    assert.equal(result.pulled, 0);
    assert.equal(result.pushed.failed, 0);
  });

  it("still runs the real pass once credentials are set", async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-client-secret";
    const result = await runGoogleSyncTick();
    assert.equal("skipped" in result, false);
    assert.equal(typeof result.pulled, "number");
  });
});
