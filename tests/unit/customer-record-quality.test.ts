import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import {
  cleanProblemText,
  formatPhoneDisplay,
  isIntentCode,
  keepVerified,
  mergeProblem,
  sameProblem,
} from "../../src/product/crm/record-quality";
import { createCrmService } from "../../src/product/crm/service";

const ORG = "org_quality";
const PHONE = "+14389936997";

describe("cleanProblemText", () => {
  it("turns the screenshot's fragments into one readable statement, without inventing anything", () => {
    const raw = [
      "Salut jai un probleme",
      "Test",
      "Hello. I have a big problem",
      "Hello I have a big problem",
      "EN",
      "I need a specialist as soon as possible",
      "My sink is broken",
      "Demande de service · Ara (Message pris)",
    ].join("\n");
    const out = cleanProblemText(raw);
    assert.match(out, /J'ai un problème\./);
    assert.equal((out.match(/I have a big problem/g) ?? []).length, 1, "the repeat is gone");
    assert.doesNotMatch(out, /\bTest\b|\bEN\b|Hello|Salut|Demande de service|Message pris/);
    assert.match(out, /I need a specialist as soon as possible\./);
    assert.match(out, /My sink is broken\./);
    // every word comes from the customer (the only edits are repairs of "jai" and "probleme")
    assert.doesNotMatch(out, /plumb|kitchen|urgent/i);
  });

  it("keeps French French and English English: it never translates", () => {
    assert.equal(
      cleanProblemText("euh, Mon évier est cassé, mon évier est cassé"),
      "Mon évier est cassé.",
    );
    assert.equal(
      cleanProblemText("hello, the the kitchen sink is leaking"),
      "The kitchen sink is leaking.",
    );
  });

  it("returns nothing for filler, language replies and product labels", () => {
    for (const noise of ["Test", "EN", "fr", "Hello", "ok merci", "Demande de service", "", undefined]) {
      assert.equal(cleanProblemText(noise), "", String(noise));
    }
  });

  it("is idempotent and bounded", () => {
    const raw = "Water is coming through the ceiling. Water is coming through the ceiling! " + "x ".repeat(500);
    const once = cleanProblemText(raw, 200);
    assert.equal(cleanProblemText(once, 200), once);
    assert.ok(once.length <= 200);
  });

  it("recognises the same problem said twice with different punctuation or accents", () => {
    assert.ok(sameProblem("Problème de plomberie!", "probleme de plomberie"));
    assert.ok(!sameProblem("Sink is broken", "Toilet is broken"));
  });
});

describe("mergeProblem: one clean statement, never a pile", () => {
  it("text replies only ever fill an empty problem", () => {
    assert.equal(mergeProblem(undefined, "My sink is broken", "sms"), "My sink is broken.");
    assert.equal(mergeProblem("My sink is broken.", "Ara", "sms"), "My sink is broken.");
    assert.equal(mergeProblem("My sink is broken.", "10160 place de l'Acadie", "missed_call"), "My sink is broken.");
  });

  it("a receptionist call replaces a raw first text with the clean statement", () => {
    assert.equal(
      mergeProblem("Jai un probleme.", "The kitchen sink is broken and the customer needs a plumber soon.", "ai_receptionist"),
      "The kitchen sink is broken and the customer needs a plumber soon.",
    );
  });

  it("a repeated delivery changes nothing, and typed notes add only what is new", () => {
    const base = "The kitchen sink is broken.";
    assert.equal(mergeProblem(base, "the kitchen sink is broken", "ai_receptionist"), base);
    assert.equal(mergeProblem(base, "Kitchen sink is broken", "website"), base);
    assert.equal(
      mergeProblem(base, "The water is also off upstairs", "website"),
      "The kitchen sink is broken. The water is also off upstairs.",
    );
  });
});

describe("keepVerified", () => {
  it("fills a missing value, completes a partial one, and never overwrites a verified one", () => {
    assert.equal(keepVerified(undefined, "Ara", "sms"), "Ara");
    assert.equal(keepVerified("Ara", "Ara Ghahramanyan", "ai_receptionist"), "Ara Ghahramanyan");
    assert.equal(keepVerified("Ara Ghahramanyan", "Ana", "sms"), undefined);
    assert.equal(keepVerified("Ara Ghahramanyan", "Ana", "ai_receptionist"), undefined);
    assert.equal(keepVerified("Ara Ghahramanyan", "Ara G.", "manual"), "Ara G.", "staff edits win");
    assert.equal(keepVerified("Ara", "  ", "sms"), undefined);
  });
});

describe("phone and service display", () => {
  it("formats North American numbers and leaves others alone", () => {
    assert.equal(formatPhoneDisplay("+14389936997"), "438-993-6997");
    assert.equal(formatPhoneDisplay("4389936997"), "438-993-6997");
    assert.equal(formatPhoneDisplay("+33612345678"), "+33612345678");
    assert.equal(formatPhoneDisplay(undefined), "");
  });
  it("knows a call intent is not a service", () => {
    assert.ok(isIntentCode("service_request"));
    assert.ok(!isIntentCode("Plumbing repair"));
  });
});

describe("one customer record from a whole conversation (CRM capture)", () => {
  function crm() {
    return createCrmService(createMemoryCrmStore());
  }

  it("keeps every raw message, but the lead holds one clean problem and one name", async () => {
    const service = crm();
    const texts = [
      "Salut jai un probleme",
      "Test",
      "EN",
      "Ara",
      "10160 place de l'Acadie",
      "My sink is broken",
    ];
    let last;
    for (const [i, body] of texts.entries()) {
      last = await service.capture({
        organizationId: ORG,
        source: "sms",
        phoneE164: PHONE,
        displayName: i === 3 ? "Ara" : undefined,
        description: body,
        message: {
          direction: "inbound",
          body,
          deliveryStatus: "delivered",
          providerMessageSid: `SM${i}`,
        },
      });
    }
    // The same text delivered again (a webhook retry) is not stored twice.
    await service.capture({
      organizationId: ORG,
      source: "sms",
      phoneE164: PHONE,
      description: "My sink is broken",
      message: {
        direction: "inbound",
        body: "My sink is broken",
        deliveryStatus: "delivered",
        providerMessageSid: "SM5",
      },
    });

    const detail = await service.getConversationBundle(ORG, last!.conversation.id);
    assert.equal(detail!.messages.length, texts.length, "raw conversation kept once each");
    assert.deepEqual(detail!.messages.map((m) => m.body), texts, "and unedited");
    assert.equal(detail!.lead!.description, "J'ai un problème.", "no fragments piled into the problem");
    assert.equal(detail!.customer.displayName, "Ara");
  });

  it("a receptionist call then sets the real service, address and problem, and keeps the verified name", async () => {
    const service = crm();
    await service.capture({
      organizationId: ORG,
      source: "sms",
      phoneE164: PHONE,
      displayName: "Ara Ghahramanyan",
      description: "Salut jai un probleme",
    });
    const result = await service.capture({
      organizationId: ORG,
      source: "ai_receptionist",
      phoneE164: PHONE,
      displayName: "Ana Ramanian", // a speech-recognition variant must not replace the name
      service: "Plumbing repair",
      description: "The kitchen sink is broken and the customer needs a plumber as soon as possible.",
      serviceAddress: "10160 Place de l'Acadie",
      location: "10160 Place de l'Acadie",
      priority: "high",
      message: {
        direction: "inbound",
        body: "The kitchen sink is broken and the customer needs a plumber as soon as possible.",
        deliveryStatus: "delivered",
        providerMessageSid: "call:rcs_1",
      },
    });
    assert.equal(result.customer.displayName, "Ara Ghahramanyan");
    assert.equal(result.lead.service, "Plumbing repair");
    assert.equal(result.lead.location, "10160 Place de l'Acadie");
    assert.equal(result.lead.priority, "high");
    assert.equal(
      result.lead.description,
      "The kitchen sink is broken and the customer needs a plumber as soon as possible.",
    );

    // Finalizing the same call a second time adds nothing.
    const again = await service.capture({
      organizationId: ORG,
      source: "ai_receptionist",
      phoneE164: PHONE,
      service: "Plumbing repair",
      description: "The kitchen sink is broken and the customer needs a plumber as soon as possible.",
      message: {
        direction: "inbound",
        body: "The kitchen sink is broken and the customer needs a plumber as soon as possible.",
        deliveryStatus: "delivered",
        providerMessageSid: "call:rcs_1",
      },
    });
    const detail = await service.getConversationBundle(ORG, again.conversation.id);
    assert.equal(detail!.messages.filter((m) => m.providerMessageSid === "call:rcs_1").length, 1);
    assert.equal(again.lead.description, result.lead.description);
  });

  it("never stores a call intent as the service, and replaces one saved earlier", async () => {
    const service = crm();
    const first = await service.capture({
      organizationId: ORG,
      source: "ai_receptionist",
      phoneE164: PHONE,
      service: "service_request",
      description: "Water heater is not heating.",
    });
    assert.equal(first.lead.service, undefined);
    const second = await service.capture({
      organizationId: ORG,
      source: "ai_receptionist",
      phoneE164: PHONE,
      service: "Water heater repair",
    });
    assert.equal(second.lead.service, "Water heater repair");
  });

  it("rejects an invalid phone number before saving anything", async () => {
    await assert.rejects(
      crm().capture({ organizationId: ORG, source: "sms", phoneE164: "12", description: "x" }),
      /valid phone number/i,
    );
  });
});
