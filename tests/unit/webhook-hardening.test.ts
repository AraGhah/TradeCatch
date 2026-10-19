import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as calendarHook } from "../../src/app/api/webhooks/google-calendar/route";
import { safeEqual } from "../../src/lib/safe-compare";
import { parseGmailPush } from "../../src/product/gmail/push";
import { verifyStripeSignature } from "../../src/product/security/stripe-webhook";

const NOW = Date.parse("2026-10-16T18:00:00.000Z");
const SECRET = "whsec_test";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
const TS = Math.floor(NOW / 1000);

function sign(payload: string, secret: string, timestamp = TS): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

describe("verifyStripeSignature", () => {
  it("accepts a valid signature", () => {
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${TS},v1=${sign(PAYLOAD, SECRET)}`, SECRET, NOW), true);
  });

  it("accepts the event when any v1 matches, as Stripe sends during secret rotation", () => {
    const old = sign(PAYLOAD, "whsec_old");
    const current = sign(PAYLOAD, SECRET);
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${TS},v1=${old},v1=${current}`, SECRET, NOW), true);
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${TS},v1=${current},v1=${old}`, SECRET, NOW), true);
  });

  it("rejects when none match, or when only an unrelated scheme matches", () => {
    const other = sign(PAYLOAD, "whsec_other");
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${TS},v1=${other},v1=${other}`, SECRET, NOW), false);
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${TS},v0=${sign(PAYLOAD, SECRET)}`, SECRET, NOW), false);
  });

  it("rejects a body that was changed after signing", () => {
    const header = `t=${TS},v1=${sign(PAYLOAD, SECRET)}`;
    assert.equal(verifyStripeSignature(`${PAYLOAD} `, header, SECRET, NOW), false);
  });

  it("rejects a replayed event outside the five-minute window, in both directions", () => {
    const old = TS - 301;
    const future = TS + 301;
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${old},v1=${sign(PAYLOAD, SECRET, old)}`, SECRET, NOW), false);
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${future},v1=${sign(PAYLOAD, SECRET, future)}`, SECRET, NOW), false);
    const edge = TS - 300;
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${edge},v1=${sign(PAYLOAD, SECRET, edge)}`, SECRET, NOW), true);
  });

  it("rejects malformed headers without throwing", () => {
    const good = sign(PAYLOAD, SECRET);
    for (const header of [
      "",
      "garbage",
      `v1=${good}`,
      `t=${TS}`,
      `t=,v1=${good}`,
      `t=abc,v1=${good}`,
      `t=${TS},v1=`,
      `t=${TS},v1=zz${good.slice(2)}`,
      `t=${TS},v1=${good.slice(2)}`,
      `t=${TS},v1=${good}00`,
      `t=${"9".repeat(40)},v1=${good}`,
    ]) {
      assert.equal(verifyStripeSignature(PAYLOAD, header, SECRET, NOW), false, header);
    }
  });

  it("uses the first timestamp, so a second t= cannot be smuggled in", () => {
    const stale = TS - 3600;
    const header = `t=${stale},v1=${sign(PAYLOAD, SECRET, stale)},t=${TS}`;
    assert.equal(verifyStripeSignature(PAYLOAD, header, SECRET, NOW), false);
  });

  it("looks at no more than a handful of signatures", () => {
    const junk = Array.from({ length: 5 }, () => `v1=${"0".repeat(64)}`).join(",");
    assert.equal(verifyStripeSignature(PAYLOAD, `t=${TS},${junk},v1=${sign(PAYLOAD, SECRET)}`, SECRET, NOW), false);
  });
});

describe("safeEqual", () => {
  it("compares by value, whatever the lengths", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
    assert.equal(safeEqual("", "abc"), false);
    assert.equal(safeEqual("", ""), true);
    assert.equal(safeEqual("é", "e"), false);
  });
});

describe("Google Calendar notifications", () => {
  const previous = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = "calendar-secret";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
    else process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = previous;
  });

  function call(headers: Record<string, string>) {
    return calendarHook(new NextRequest("http://localhost/api/webhooks/google-calendar", { method: "POST", headers }));
  }

  it("refuses a missing or wrong token before looking at anything else", async () => {
    assert.equal((await call({ "x-goog-channel-id": "org_1" })).status, 401);
    assert.equal((await call({ "x-goog-channel-token": "nope", "x-goog-channel-id": "org_1" })).status, 401);
    assert.equal((await call({ "x-goog-channel-token": "calendar-secre", "x-goog-channel-id": "org_1" })).status, 401);
  });

  it("refuses everything when no token is configured, even an empty one", async () => {
    delete process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
    assert.equal((await call({ "x-goog-channel-token": "", "x-goog-channel-id": "org_1" })).status, 401);
    process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = "   ";
    assert.equal((await call({ "x-goog-channel-token": "", "x-goog-channel-id": "org_1" })).status, 401);
  });

  it("refuses a channel id that is not an organization id", async () => {
    for (const id of ["", "a b", "org_1; drop table", "x".repeat(81), "../etc"]) {
      const res = await call({ "x-goog-channel-token": "calendar-secret", "x-goog-channel-id": id });
      assert.equal(res.status, 400, JSON.stringify(id));
    }
    assert.equal((await call({ "x-goog-channel-token": "calendar-secret" })).status, 400);
  });
});

describe("parseGmailPush", () => {
  const encode = (value: unknown, encoding: BufferEncoding = "base64") =>
    Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString(encoding);
  const wrap = (data: string) => ({ message: { data, messageId: "1" }, subscription: "projects/p/subscriptions/s" });

  it("reads the address and history id from a real notification", () => {
    assert.deepEqual(parseGmailPush(wrap(encode({ emailAddress: "alice@gmail.com", historyId: 1234567 }))), {
      email: "alice@gmail.com",
      historyId: "1234567",
    });
    assert.deepEqual(parseGmailPush(wrap(encode({ emailAddress: "alice@gmail.com", historyId: "9876543210" }))), {
      email: "alice@gmail.com",
      historyId: "9876543210",
    });
    assert.deepEqual(parseGmailPush(wrap(encode({ emailAddress: "alice@gmail.com" }))), {
      email: "alice@gmail.com",
      historyId: undefined,
    });
  });

  it("accepts the URL-safe base64 alphabet too", () => {
    // "??>" encodes to "Pz8-" in the URL-safe alphabet and "Pz8+" in the standard one.
    const data = encode({ emailAddress: "alice@example.com", historyId: 5, note: "??>" }, "base64url");
    assert.equal(parseGmailPush(wrap(data))?.email, "alice@example.com");
  });

  it("ignores anything that is not a notification", () => {
    const good = encode({ emailAddress: "alice@gmail.com", historyId: 1 });
    const cases: unknown[] = [
      null,
      undefined,
      "text",
      42,
      [],
      {},
      { message: null },
      { message: {} },
      { message: { data: "" } },
      { message: { data: 5 } },
      { message: { data: "not base64!!" } },
      { message: { data: encode("not json") } },
      { message: { data: encode("null") } },
      { message: { data: encode([]) } },
      { message: { data: encode({}) } },
      { message: { data: encode({ emailAddress: "" }) } },
      { message: { data: encode({ emailAddress: 7 }) } },
      { message: { data: encode({ emailAddress: "not an address" }) } },
      { message: { data: encode({ emailAddress: "a@b.com", historyId: "12abc" }) } },
      { message: { data: encode({ emailAddress: "a@b.com", historyId: -1 }) } },
      { message: { data: encode({ emailAddress: "a@b.com", historyId: 1.5 }) } },
      { message: { data: encode({ emailAddress: "a@b.com", historyId: { $gt: 0 } }) } },
      { message: { data: encode({ emailAddress: "a@b.com", historyId: "1".repeat(30) }) } },
      { message: { data: "A".repeat(5000) } },
      { message: { data: `${good}\n<script>` } },
    ];
    for (const body of cases) assert.equal(parseGmailPush(body), null, JSON.stringify(body)?.slice(0, 80));
  });

  it("never throws on hostile input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.message = cyclic;
    assert.doesNotThrow(() => parseGmailPush(cyclic));
    assert.doesNotThrow(() => parseGmailPush({ message: { data: "%%%%" } }));
  });
});
