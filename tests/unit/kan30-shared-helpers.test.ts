/**
 * KAN-30: the helpers that replaced duplicated copies. Each block pins the
 * exact behaviour the old copies had, so a later edit cannot drift one caller.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeBase64Url, encodeBase64Url } from "../../src/lib/base64url";
import { escapeHtml, escapeXml } from "../../src/lib/escape";
import { createPostgresPoolCache } from "../../src/lib/postgres-pool";
import { isValidTimeZone } from "../../src/lib/time-zone";
import { isValidTimeZone as slotsIsValidTimeZone } from "../../src/product/scheduling/slots";
import { escapeSsmlText } from "../../src/product/receptionist/speech-style";
import { escapeXml as voiceEscapeXml } from "../../src/product/receptionist/voice";
import {
  PLAN_IDS,
  PUBLIC_PLAN_IDS,
  isPlanId,
  isPublicPlanId,
} from "../../src/product/saas/entitlements";
import { isPlanId as catalogIsPlanId, isSoldPlan } from "../../src/product/saas/plan-catalog";
import { ownerPhone, primaryPhone } from "../../src/product/receptionist/roster-phones";
import { planMessages } from "../../src/product/receptionist/simulation";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import type { VoicePlan } from "../../src/product/receptionist/types";

describe("escapeHtml / escapeXml", () => {
  const sample = `Tom & Jerry's <b>"quote"</b>`;

  it("escapeHtml encodes the five characters, apostrophe as &#39;", () => {
    assert.equal(escapeHtml(sample), "Tom &amp; Jerry&#39;s &lt;b&gt;&quot;quote&quot;&lt;/b&gt;");
  });

  it("escapeXml encodes the five characters, apostrophe as &apos;", () => {
    assert.equal(escapeXml(sample), "Tom &amp; Jerry&apos;s &lt;b&gt;&quot;quote&quot;&lt;/b&gt;");
  });

  it("escapes & first, so existing entities are not double-decoded", () => {
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
    assert.equal(escapeXml("&amp;"), "&amp;amp;");
  });

  it("the receptionist's SSML and TwiML escapers are the shared XML one", () => {
    assert.equal(escapeSsmlText, escapeXml);
    assert.equal(voiceEscapeXml, escapeXml);
  });
});

describe("base64url", () => {
  it("matches Node's native base64url encoding (no padding, URL-safe)", () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33, 255]) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 251) % 256));
      const encoded = encodeBase64Url(buf);
      assert.equal(encoded, buf.toString("base64url"));
      assert.doesNotMatch(encoded, /[+/=]/);
      assert.deepEqual(decodeBase64Url(encoded), buf);
    }
  });

  it("round-trips UTF-8 text", () => {
    const text = "org_1\nélodie@exemple.ca";
    assert.equal(decodeBase64Url(encodeBase64Url(Buffer.from(text, "utf8"))).toString("utf8"), text);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects empty, missing or unknown values", () => {
    assert.equal(isValidTimeZone("America/Toronto"), true);
    assert.equal(isValidTimeZone("UTC"), true);
    assert.equal(isValidTimeZone(""), false);
    assert.equal(isValidTimeZone(undefined), false);
    assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  });

  it("scheduling/slots re-exports the shared function", () => {
    assert.equal(slotsIsValidTimeZone, isValidTimeZone);
  });
});

describe("createPostgresPoolCache", () => {
  it("returns one pool per connection string, with the cache's options", async () => {
    const getPool = createPostgresPoolCache({ max: 5 });
    const a = getPool("postgresql://u:p@127.0.0.1:1/a");
    const again = getPool("postgresql://u:p@127.0.0.1:1/a");
    const b = getPool("postgresql://u:p@127.0.0.1:1/b");
    try {
      assert.equal(a, again);
      assert.notEqual(a, b);
      assert.equal((a as unknown as { options: { max: number } }).options.max, 5);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("keeps each store's cache separate, as the per-module Maps did", async () => {
    const url = "postgresql://u:p@127.0.0.1:1/shared";
    const first = createPostgresPoolCache({ max: 5 })(url);
    const second = createPostgresPoolCache({ max: 5 })(url);
    try {
      assert.notEqual(first, second);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});

describe("plan id guards", () => {
  const junk: unknown[] = ["", "Essential", "enterprise", 0, null, undefined, {}];

  it("isPlanId accepts every plan id and nothing else, from either module", () => {
    assert.equal(catalogIsPlanId, isPlanId);
    for (const id of PLAN_IDS) assert.equal(isPlanId(id), true);
    for (const value of junk) assert.equal(isPlanId(value), false);
  });

  it("isSoldPlan is exactly isPublicPlanId", () => {
    for (const value of [...PLAN_IDS, ...junk]) {
      assert.equal(isSoldPlan(value), isPublicPlanId(value), String(value));
    }
    for (const id of PUBLIC_PLAN_IDS) assert.equal(isSoldPlan(id), true);
  });
});

describe("roster phones", () => {
  it("returns the owner and main technician phones only while active", () => {
    const client = demoClientAccount();
    const owner = client.technicianRoster.find((t) => t.id === client.ownerTechnicianId);
    const main = client.technicianRoster.find((t) => t.id === client.mainTechnicianId);
    assert.ok(owner && main, "fixture has an owner and a main technician");
    assert.equal(ownerPhone(client), owner.phone);
    assert.equal(primaryPhone(client), main.phone);

    const inactive = {
      ...client,
      technicianRoster: client.technicianRoster.map((t) => ({ ...t, active: false })),
    };
    assert.equal(ownerPhone(inactive), undefined);
    assert.equal(primaryPhone(inactive), undefined);
    assert.equal(ownerPhone({ ...client, ownerTechnicianId: undefined }), undefined);
  });
});

describe("planMessages", () => {
  it("collects say and gather prompts, trimmed, without consecutive repeats", () => {
    const plan = {
      verbs: [
        { verb: "say", text: "  Hello  " },
        { verb: "say", text: "Hello" },
        { verb: "gather", prompts: [{ text: "How can I help?" }, { text: "" }] },
        { verb: "hangup" },
      ],
    } as unknown as VoicePlan;
    assert.deepEqual(planMessages(plan), [
      { role: "agent", text: "Hello" },
      { role: "agent", text: "How can I help?" },
    ]);
  });
});
