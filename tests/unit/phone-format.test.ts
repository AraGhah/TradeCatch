/**
 * KAN-15 · phone numbers (CALL-01, CALL-02).
 *
 * Stored as E.164, shown the way a person reads them, never truncated,
 * duplicated or altered when they cannot be read.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPhone,
  isWithheldCaller,
  normalizeProviderNumber,
  parsePhone,
  toE164,
} from "../../src/lib/phone";
import { formatPhoneDisplay } from "../../src/product/crm/record-quality";

describe("CALL-01 · a Canadian number shows as (514) 555-1234", () => {
  it("formats the stored E.164 value", () => {
    assert.equal(formatPhone("+15145551234"), "(514) 555-1234");
    assert.equal(formatPhoneDisplay("+15145551234"), "(514) 555-1234");
  });

  it("reads every common way of writing the same number", () => {
    for (const written of [
      "+15145551234",
      "+1 514 555 1234",
      "+1 (514) 555-1234",
      "1-514-555-1234",
      "15145551234",
      "514-555-1234",
      "(514) 555-1234",
      "514.555.1234",
      "514 555 1234",
      "  (514)555-1234  ",
    ]) {
      assert.equal(toE164(written), "+15145551234", written);
      assert.equal(formatPhone(written), "(514) 555-1234", written);
    }
  });

  it("formats a US number the same way", () => {
    assert.equal(formatPhone("+12125551234"), "(212) 555-1234");
  });
});

describe("CALL-02 · an international number is readable", () => {
  it("groups each country the way it writes numbers", () => {
    assert.equal(formatPhone("+33142685300"), "+33 1 42 68 53 00");
    assert.equal(formatPhone("+33612345678"), "+33 6 12 34 56 78");
    assert.equal(formatPhone("+442079460958"), "+44 20 7946 0958");
    assert.equal(formatPhone("+4915112345678"), "+49 1511 2345678");
  });

  it("keeps the country code when it is typed with spaces", () => {
    assert.equal(toE164("+33 1 42 68 53 00"), "+33142685300");
    assert.equal(toE164("+44 (0)20 7946 0958"), "+442079460958");
  });
});

describe("extensions are kept apart from the digits", () => {
  it("returns the extension separately and never appends it to the number", () => {
    for (const written of [
      "514-555-1234 x22",
      "514-555-1234 ext. 22",
      "(514) 555-1234 ext 22",
      "514 555 1234 poste 22",
      "+1 514 555 1234 #22",
    ]) {
      assert.deepEqual(
        { e164: parsePhone(written)?.e164, ext: parsePhone(written)?.extension },
        { e164: "+15145551234", ext: "22" },
        written,
      );
      assert.equal(formatPhone(written), "(514) 555-1234 ext. 22", written);
    }
    // "+514555123422" would be the old, corrupted result.
    assert.equal(toE164("514-555-1234 x22"), "+15145551234");
  });

  it("shows an extension on an international number too", () => {
    assert.equal(formatPhone("+442079460958 x5"), "+44 20 7946 0958 ext. 5");
  });
});

describe("a number is never altered when it cannot be read", () => {
  it("refuses what is not a phone number", () => {
    for (const text of ["", "abc", "call me", "555-0123", "+1514555", "514-555-1234 and 9", "sip:alice@example.com"]) {
      assert.equal(parsePhone(text), null, JSON.stringify(text));
    }
  });

  it("formatPhone returns unreadable input unchanged and nothing for nothing", () => {
    assert.equal(formatPhone("anonymous"), "anonymous");
    assert.equal(formatPhone("sip:alice@example.com"), "sip:alice@example.com");
    assert.equal(formatPhone(undefined), "");
    assert.equal(formatPhone(null), "");
    assert.equal(formatPhone("   "), "");
  });

  it("does not pull a number out of a sentence", () => {
    assert.equal(parsePhone("my number is 514 555 1234 thanks"), null);
  });

  it("is idempotent: reading an E.164 value gives it back", () => {
    for (const e164 of ["+15145551234", "+33142685300", "+442079460958"]) {
      assert.equal(toE164(e164), e164);
    }
  });

  it("never reads a very long string", () => {
    assert.equal(parsePhone("1".repeat(500)), null);
  });
});

describe("withheld caller IDs", () => {
  it("recognises the words and the placeholder numbers carriers send", () => {
    for (const id of ["anonymous", "Anonymous", "restricted", "unknown", "+266696687", "266696687", "+86282452253"]) {
      assert.equal(isWithheldCaller(id), true, id);
    }
    for (const id of ["+15145551234", "", undefined, null]) {
      assert.equal(isWithheldCaller(id), false, String(id));
    }
  });

  it("is never turned into a number", () => {
    assert.equal(toE164("+266696687"), null);
    assert.equal(toE164("anonymous"), null);
  });
});

describe("normalizeProviderNumber (what is stored for a provider's number)", () => {
  it("stores E.164 when the number can be read", () => {
    assert.equal(normalizeProviderNumber("5145551234"), "+15145551234");
    assert.equal(normalizeProviderNumber("+15145551234"), "+15145551234");
  });

  it("keeps what it cannot read, as received", () => {
    assert.equal(normalizeProviderNumber("anonymous"), "anonymous");
    assert.equal(normalizeProviderNumber("+266696687"), "+266696687");
    assert.equal(normalizeProviderNumber(""), "");
    assert.equal(normalizeProviderNumber(undefined), "");
  });

  it("bounds what it keeps", () => {
    assert.equal(normalizeProviderNumber("x".repeat(500)).length, 64);
  });
});
