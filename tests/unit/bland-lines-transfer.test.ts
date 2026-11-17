import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { buildBlandConfig } from "../../src/product/receptionist/bland/config";
import {
  bearerToken,
  findBlandLine,
  hashBlandToken,
  loadBlandLines,
  newBlandLineToken,
  resetBlandLinesCacheForTests,
  verifyBlandToken,
} from "../../src/product/receptionist/bland/lines";
import { blandTransfer } from "../../src/product/receptionist/bland/transfer";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";

const LINE = "+15145550111";
const BUSINESS = "+14385550100";
const hash = hashBlandToken("tcbl_example");

describe("Bland line registry", () => {
  afterEach(() => resetBlandLinesCacheForTests());

  it("reads valid lines and defaults the business number to the line itself", () => {
    const lines = loadBlandLines({
      BLAND_LINES_JSON: JSON.stringify([
        { number: LINE, tokenSha256: hash },
        { number: "+15145550222", receptionistNumber: BUSINESS, tokenSha256: hash.toUpperCase() },
      ]),
    } as never);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].receptionistNumber, LINE);
    assert.equal(lines[1].tokenSha256, hash, "stored hash is normalised");
  });

  it("skips invalid entries without discarding the valid ones", () => {
    const quiet = mock.method(console, "error", () => {});
    try {
      const lines = loadBlandLines({
        BLAND_LINES_JSON: JSON.stringify([
          { number: "not-a-number", tokenSha256: hash },
          { number: LINE, tokenSha256: "short" },
          { number: "+15145550333", tokenSha256: hash },
        ]),
      } as never);
      assert.deepEqual(lines.map((l) => l.number), ["+15145550333"]);
    } finally {
      quiet.mock.restore();
    }
  });

  it("serves neither entry of a duplicated number (ambiguous, fails closed)", () => {
    const quiet = mock.method(console, "error", () => {});
    try {
      const lines = loadBlandLines({
        BLAND_LINES_JSON: JSON.stringify([
          { number: LINE, receptionistNumber: BUSINESS, tokenSha256: hash },
          { number: LINE, receptionistNumber: "+14385550200", tokenSha256: hashBlandToken("other") },
        ]),
      } as never);
      assert.deepEqual(lines, []);
    } finally {
      quiet.mock.restore();
    }
  });

  it("no registry, bad JSON or a non-array means no lines", () => {
    const quiet = mock.method(console, "error", () => {});
    try {
      for (const raw of [undefined, "", "{nope", '{"number":"x"}']) {
        resetBlandLinesCacheForTests();
        assert.deepEqual(loadBlandLines({ BLAND_LINES_JSON: raw } as never), []);
      }
    } finally {
      quiet.mock.restore();
    }
  });

  it("finds a line by any formatting of its number, never by a short fragment", () => {
    const lines = loadBlandLines({ BLAND_LINES_JSON: JSON.stringify([{ number: LINE, tokenSha256: hash }]) } as never);
    assert.ok(findBlandLine(lines, "(514) 555-0111"));
    assert.ok(findBlandLine(lines, "15145550111"));
    assert.equal(findBlandLine(lines, "5550111"), undefined);
    assert.equal(findBlandLine(lines, undefined), undefined);
  });

  it("verifies a token against its stored hash only", () => {
    const { token, tokenSha256 } = newBlandLineToken();
    assert.match(token, /^tcbl_[0-9a-f]{64}$/);
    const line = { number: LINE, receptionistNumber: LINE, tokenSha256 };
    assert.equal(verifyBlandToken(line, token), true);
    assert.equal(verifyBlandToken(line, token + "x"), false);
    assert.equal(verifyBlandToken(line, tokenSha256), false, "the stored hash is not a token");
    assert.equal(verifyBlandToken(line, ""), false);
    assert.equal(verifyBlandToken(line, undefined), false);
    assert.equal(verifyBlandToken(undefined, token), false, "an unknown line never verifies");
  });

  it("reads only a well-formed bearer header", () => {
    assert.equal(bearerToken("Bearer abc"), "abc");
    assert.equal(bearerToken("bearer abc"), undefined);
    assert.equal(bearerToken("Basic abc"), undefined);
    assert.equal(bearerToken("Bearer "), undefined);
    assert.equal(bearerToken(null), undefined);
    assert.equal(bearerToken(`Bearer ${"x".repeat(500)}`), undefined);
  });
});

const makeConfig = (over: Record<string, unknown> = {}) =>
  parseReceptionistConfig({
    id: "rc_t",
    clientAccountId: "client_t",
    phoneNumberE164: BUSINESS,
    businessName: "Nord Plomberie",
    notifications: [],
    transferHours: "always",
    ...over,
  });

describe("Bland transfer destinations", () => {
  const input = { lineNumber: LINE, afterHours: false };

  it("maps the normal, backup, emergency and department numbers to Bland's transfer_list", () => {
    const t = blandTransfer(
      makeConfig({
        fallbackTransferE164: "+15145550142",
        backupTransferE164: "+15145550144",
        emergencyTransferE164: "+15145550143",
        routing: [{ id: "billing", name: "Billing", phoneE164: "+15145550145" }],
      }),
      input,
    );
    assert.deepEqual(t.transferList, {
      default: "+15145550142",
      backup: "+15145550144",
      emergency: "+15145550143",
      billing: "+15145550145",
    });
    assert.deepEqual(t.rejected, []);
    assert.equal(t.normalAllowedNow, true);
  });

  it("an emergency with no emergency line falls back to the normal line", () => {
    const t = blandTransfer(makeConfig({ fallbackTransferE164: "+15145550142" }), input);
    assert.equal(t.emergency, "+15145550142");
  });

  it("withholds normal transfers after hours when the owner limited them, but never the emergency line", () => {
    const config = makeConfig({
      transferHours: "business_hours",
      fallbackTransferE164: "+15145550142",
      backupTransferE164: "+15145550144",
      emergencyTransferE164: "+15145550143",
      routing: [{ id: "billing", name: "Billing", phoneE164: "+15145550145" }],
    });
    const closed = blandTransfer(config, { ...input, afterHours: true });
    assert.equal(closed.normal, null);
    assert.equal(closed.backup, null);
    assert.deepEqual(closed.departments, []);
    assert.equal(closed.normalAllowedNow, false);
    assert.deepEqual(closed.transferList, { emergency: "+15145550143" });
    assert.equal(blandTransfer(config, { ...input, afterHours: false }).normal, "+15145550142");
  });

  it("never offers a number that would ring the agent again", () => {
    const t = blandTransfer(
      makeConfig({
        fallbackTransferE164: BUSINESS,
        emergencyTransferE164: LINE,
        backupTransferE164: "+15145550144",
        smsFromE164: "+14385550199",
        routing: [{ id: "sms", name: "Texts", phoneE164: "+14385550199" }],
      }),
      input,
    );
    assert.equal(t.normal, null);
    assert.equal(t.emergency, null);
    assert.deepEqual(
      t.rejected.map((r) => [r.field, r.reason]).sort(),
      [
        ["department:sms", "loops_to_line"],
        ["emergency", "loops_to_line"],
        ["normal", "loops_to_line"],
      ],
    );
  });

  it("rejects what is not a dialable E.164 number, and reports the field not the value", () => {
    const config = makeConfig({ fallbackTransferE164: "+15145550142" });
    // Env configs only had to look like E.164; a profile also has to be Canadian-geographic.
    (config as { fallbackTransferE164?: string }).fallbackTransferE164 = "911";
    (config as { emergencyTransferE164?: string }).emergencyTransferE164 = "+1 (514) 555-0143";
    const t = blandTransfer(config, input);
    assert.deepEqual(
      t.rejected.map((r) => [r.field, r.reason]),
      [
        ["normal", "invalid_number"],
        ["emergency", "invalid_number"],
      ],
    );
    assert.equal(JSON.stringify(t.rejected).includes("911"), false);
    assert.deepEqual(t.transferList, {});
  });

  it("a tenant profile's number must also pass the toll-fraud rule", () => {
    const profile = makeConfig({ fallbackTransferE164: "+15145550142" });
    (profile as { source?: string }).source = "profile";
    (profile as { fallbackTransferE164?: string }).fallbackTransferE164 = "+19005550123"; // not a Canadian area code
    const t = blandTransfer(profile, input);
    assert.equal(t.normal, null);
    assert.deepEqual(t.rejected, [{ field: "normal", reason: "invalid_number" }]);
  });
});

describe("Bland call-start config", () => {
  const line = { number: LINE, receptionistNumber: BUSINESS, tokenSha256: hash };
  const build = (config = makeConfig(), over: Partial<Parameters<typeof buildBlandConfig>[1]> = {}) =>
    buildBlandConfig(config, {
      line,
      now: new Date("2026-11-18T16:00:00Z"),
      from: "+15145559876",
      bookingProvider: null,
      ...over,
    });

  it("says booking works only when a real provider is behind it", () => {
    assert.equal(build().capabilities.booking, false);
    assert.equal(build().capabilities.bookingProvider, "none");
    const live = build(makeConfig(), { bookingProvider: "calcom" });
    assert.equal(live.capabilities.booking, true);
    assert.equal(live.capabilities.bookingProvider, "calcom");
  });

  it("texting comes from Twilio, unless the business's number is one Bland answers", () => {
    const config = makeConfig({ smsFromE164: "+14385550199" });
    assert.equal(build(config).line.smsChannel, "twilio");
    assert.equal(build(config).capabilities.callerTexts, true);

    process.env.BLAND_LINES_JSON = JSON.stringify([
      { number: LINE, receptionistNumber: BUSINESS, tokenSha256: hash, smsNumber: "+14385550199" },
    ]);
    resetBlandLinesCacheForTests();
    try {
      const conflict = build(config, { line: { ...line, smsNumber: "+14385550199" } });
      assert.equal(conflict.line.smsConflict, true);
      assert.equal(conflict.capabilities.callerTexts, false);
    } finally {
      delete process.env.BLAND_LINES_JSON;
      resetBlandLinesCacheForTests();
    }
  });

  it("carries the transfer numbers and the business facts, in the business's own timezone", () => {
    const config = makeConfig({
      fallbackTransferE164: "+15145550142",
      emergencyTransferE164: "+15145550143",
      businessAddress: "1 Rue Test, Laval",
      timezone: "America/Toronto",
    });
    const built = build(config);
    assert.equal(built.transfer.normal, "+15145550142");
    assert.equal(built.transfer.emergency, "+15145550143");
    assert.equal(built.business.name, "Nord Plomberie");
    assert.equal(built.business.timezone, "America/Toronto");
    assert.equal(built.business.address, "1 Rue Test, Laval");
  });
});
