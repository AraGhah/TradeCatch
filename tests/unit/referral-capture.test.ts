import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { recallReferralCode, REFERRAL_CAPTURE_DAYS } from "../../src/lib/referral-capture";

describe("referral capture expiry", () => {
  const originalWindow = globalThis.window;
  afterEach(() => {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  });

  it("keeps a recent referral but removes expired and future-dated records", () => {
    let stored: string | null = null;
    const localStorage = {
      getItem: () => stored,
      removeItem: () => { stored = null; },
    };
    Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
    const code = "23456789AB";
    stored = JSON.stringify({ code, savedAt: Date.now() - 1000 });
    assert.equal(recallReferralCode(), code);
    stored = JSON.stringify({ code, savedAt: Date.now() - (REFERRAL_CAPTURE_DAYS + 1) * 86_400_000 });
    assert.equal(recallReferralCode(), null);
    assert.equal(stored, null);
    stored = JSON.stringify({ code, savedAt: Date.now() + 86_400_000 });
    assert.equal(recallReferralCode(), null);
    assert.equal(stored, null);
  });
});
