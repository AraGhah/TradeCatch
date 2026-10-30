import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import type {
  ClientAccount,
  OutboundMessageRecord,
  OutboundSms,
} from "../../src/product/missed-call/types";
import type { LlmClient } from "../../src/product/receptionist/llm";
import type { ReceptionistScheduler } from "../../src/product/receptionist/booking";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";
import {
  detectLanguage,
  fallbackReply,
  parseModelReply,
  sanitizeReply,
  MAX_REPLY_CHARS,
  type BusinessContext,
} from "../../src/product/sms-receptionist/reply";
import {
  createSmsReceptionist,
  MAX_AUTO_REPLIES_PER_HOUR,
  type HistoryMessage,
  type SmsReceptionistDeps,
  type SmsReceptionistInput,
} from "../../src/product/sms-receptionist/service";

// Wednesday 11:00 in Toronto; Wednesday 23:00 the night before for quiet hours.
const OPEN = new Date("2026-10-28T15:00:00Z");
const NIGHT = new Date("2026-10-28T03:00:00Z");
const CUSTOMER = "+15145551234";
const SLOT_A = "2026-10-29T14:00:00.000Z";
const SLOT_B = "2026-10-29T18:00:00.000Z";

const context: BusinessContext = {
  name: "Nord Plomberie",
  timezone: "America/Toronto",
  hours: { start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] },
  serviceAreaNotes: "Montréal et Laval",
  faqs: [],
  collectPreferredTime: true,
};

const bookingConfig = {
  id: "cfg_1",
  clientAccountId: "client_demo",
  phoneBooking: true,
} as unknown as ReceptionistConfig;

type Overrides = {
  client?: Partial<ClientAccount>;
  now?: Date;
  llm?: LlmClient | null;
  scheduler?: ReceptionistScheduler | null;
  booking?: boolean;
  history?: HistoryMessage[];
  org?: { status: string; entitled: boolean } | null;
  suppressed?: boolean;
  activeWorkflow?: boolean;
  enqueueFails?: boolean;
  sendFails?: boolean;
};

function llmReturning(
  value: unknown,
): LlmClient & { calls: number; last?: { system: string; user: string } } {
  const llm = {
    provider: "anthropic" as const,
    model: "fake",
    calls: 0,
    last: undefined as { system: string; user: string } | undefined,
    async generateJson(input: { system: string; user: string }) {
      llm.calls += 1;
      llm.last = { system: input.system, user: input.user };
      if (value instanceof Error) throw value;
      return value;
    },
    async generateText() {
      return "";
    },
  };
  return llm;
}

function schedulerFake(
  reserve: ReceptionistScheduler["reserve"],
): ReceptionistScheduler & {
  reserveCalls: Parameters<ReceptionistScheduler["reserve"]>[0][];
} {
  const reserveCalls: Parameters<ReceptionistScheduler["reserve"]>[0][] = [];
  return {
    reserveCalls,
    async listOpenings() {
      return {
        ok: true,
        timezone: "America/Toronto",
        service: { id: "svc_1", name: "Service call" },
        slots: [
          { startAt: SLOT_A, endAt: "2026-10-29T15:00:00.000Z" },
          { startAt: SLOT_B, endAt: "2026-10-29T19:00:00.000Z" },
        ],
      };
    },
    async reserve(input) {
      reserveCalls.push(input);
      return reserve(input);
    },
  };
}

function harness(overrides: Overrides = {}) {
  const client = demoClientAccount({
    id: "client_demo",
    smsFromNumber: "+14382314700",
    ...overrides.client,
  });
  const outbox = new Map<string, OutboundMessageRecord>();
  const claimed = new Set<string>();
  const sent: OutboundSms[] = [];
  const escalations: Parameters<SmsReceptionistDeps["escalate"]>[0][] = [];
  const crm: { body: string; sent: boolean }[] = [];
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const failed: string[] = [];

  const deps: SmsReceptionistDeps = {
    now: () => overrides.now ?? OPEN,
    async getOrganization() {
      return overrides.org === undefined
        ? { status: "active", entitled: true }
        : overrides.org;
    },
    async isSuppressed() {
      return overrides.suppressed ?? false;
    },
    async hasActiveWorkflow() {
      return overrides.activeWorkflow ?? false;
    },
    async quietHours() {
      return { windowStartHour: 8, windowEndHour: 20, weekendSending: true };
    },
    async history() {
      return overrides.history ?? [];
    },
    async loadBusiness() {
      return {
        context,
        bookingConfig: overrides.booking ? bookingConfig : undefined,
      };
    },
    scheduler: overrides.scheduler ?? null,
    llm: overrides.llm === undefined ? null : overrides.llm,
    outbox: {
      async enqueue(message) {
        if (overrides.enqueueFails) throw new Error("db down");
        if (!outbox.has(message.id)) outbox.set(message.id, message);
      },
      async claim(id) {
        if (claimed.has(id)) return null;
        claimed.add(id);
        return outbox.get(id) ?? null;
      },
      async markSent() {},
      async markFailed(id) {
        failed.push(id);
      },
    },
    async sendSms(message) {
      if (overrides.sendFails) throw new Error("twilio 21211 to +15145551234");
      sent.push(message);
      return { sid: `SM_out_${sent.length}` };
    },
    async recordOutbound({ body, sent: wasSent }) {
      crm.push({ body, sent: wasSent });
    },
    async escalate(input) {
      escalations.push(input);
    },
    log(event, fields) {
      logs.push({ event, fields });
    },
  };

  const service = createSmsReceptionist(deps);
  const input = (
    body: string,
    extra: Partial<SmsReceptionistInput> = {},
  ): SmsReceptionistInput => ({
    organizationId: "org_1",
    client,
    fromE164: CUSTOMER,
    toE164: client.smsFromNumber,
    body,
    messageSid: "SM_in_1",
    paused: false,
    quoteThreadActive: false,
    ...extra,
  });
  return {
    service,
    input,
    outbox,
    sent,
    escalations,
    crm,
    logs,
    failed,
    client,
  };
}

describe("sms receptionist — new customers", () => {
  it("answers 'Salut, j'ai un problème' with one French reply and records it", async () => {
    const h = harness();
    const result = await h.service.handleCustomerSms(
      h.input("Salut, j'ai un problème"),
    );
    assert.equal(result.status, "replied");
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0]!.toE164, CUSTOMER);
    assert.equal(h.sent[0]!.fromE164, "+14382314700");
    assert.equal(
      h.sent[0]!.body,
      fallbackReply("fr", { name: "Nord Plomberie" }),
    );
    assert.match(h.sent[0]!.body, /assistant virtuel/);
    assert.deepEqual(h.crm, [{ body: h.sent[0]!.body, sent: true }]);
    assert.ok(h.outbox.has("smsrep_SM_in_1"));
  });

  it("answers in English when the customer writes English", async () => {
    const h = harness();
    await h.service.handleCustomerSms(
      h.input("Hi, I have a leak under my sink"),
    );
    assert.equal(
      h.sent[0]!.body,
      fallbackReply("en", { name: "Nord Plomberie" }),
    );
  });

  it("uses the model reply and verified business info when a model is configured", async () => {
    const llm = llmReturning({
      reply: "Bonjour! Quel est votre nom et l’adresse du service?",
      action: "reply",
      language: "fr",
    });
    const h = harness({ llm });
    const result = await h.service.handleCustomerSms(
      h.input("Bonjour, quelles sont vos heures?"),
    );
    assert.equal(result.status === "replied" && result.source, "model");
    assert.equal(
      h.sent[0]!.body,
      "Bonjour! Quel est votre nom et l’adresse du service?",
    );
    assert.match(
      llm.last!.system,
      /Business hours: Mon, Tue, Wed, Thu, Fri 08:00–17:00/,
    );
    assert.match(llm.last!.system, /Service area: Montréal et Laval/);
    assert.match(llm.last!.system, /never invent/i);
    assert.equal(h.escalations.length, 0);
  });

  it("sends conversation history to the model without the current message twice", async () => {
    const llm = llmReturning({
      reply: "Merci!",
      action: "reply",
      language: "fr",
    });
    const h = harness({
      llm,
      history: [
        {
          direction: "inbound",
          body: "Mon évier coule",
          at: "2026-10-28T14:55:00Z",
          providerMessageSid: "SM_old",
        },
        {
          direction: "outbound",
          body: "Quelle est votre adresse?",
          at: "2026-10-28T14:56:00Z",
          automated: true,
        },
        {
          direction: "inbound",
          body: "12 rue Main",
          at: "2026-10-28T14:59:00Z",
          providerMessageSid: "SM_in_1",
        },
      ],
    });
    await h.service.handleCustomerSms(h.input("12 rue Main"));
    assert.match(llm.last!.user, /Customer: Mon évier coule/);
    assert.match(llm.last!.user, /Assistant: Quelle est votre adresse\?/);
    assert.equal(llm.last!.user.split("12 rue Main").length - 1, 1);
  });
});

describe("sms receptionist — AI failure", () => {
  it("falls back to the acknowledgement when the model throws", async () => {
    const h = harness({ llm: llmReturning(new Error("anthropic 529")) });
    const result = await h.service.handleCustomerSms(
      h.input("Bonjour j'ai un problème"),
    );
    assert.equal(result.status === "replied" && result.source, "fallback");
    assert.equal(h.sent.length, 1);
    assert.equal(h.escalations[0]?.reason, "ai_unavailable");
    assert.ok(h.logs.some((l) => l.event === "ai_failed"));
  });

  it("falls back when the model returns an unusable object", async () => {
    const h = harness({ llm: llmReturning({ nonsense: true }) });
    const result = await h.service.handleCustomerSms(h.input("Hello there"));
    assert.equal(result.status === "replied" && result.source, "fallback");
  });

  it("does not repeat the acknowledgement to a customer who already got it", async () => {
    const h = harness({
      history: [
        {
          direction: "outbound",
          body: fallbackReply("fr", { name: "Nord Plomberie" }),
          at: "2026-10-28T14:50:00Z",
          automated: true,
        },
      ],
    });
    const result = await h.service.handleCustomerSms(
      h.input("Allo?", { messageSid: "SM_in_2" }),
    );
    assert.deepEqual(result, {
      status: "skipped",
      reason: "fallback_already_sent",
    });
    assert.equal(h.sent.length, 0);
    assert.equal(h.escalations[0]?.alertStaff, false);
  });

  it("replaces a model reply that claims a booking nobody made", async () => {
    const llm = llmReturning({
      reply: "You're booked for tomorrow at 2 PM!",
      action: "reply",
      language: "en",
    });
    const h = harness({ llm });
    await h.service.handleCustomerSms(
      h.input("Can you come tomorrow at 2 PM?"),
    );
    assert.doesNotMatch(h.sent[0]!.body, /booked/i);
    assert.equal(
      h.sent[0]!.body,
      fallbackReply("en", { name: "Nord Plomberie" }),
    );
  });
});

describe("sms receptionist — booking", () => {
  const bookLlm = (extra: Record<string, unknown> = {}) =>
    llmReturning({
      reply: "Great, you're booked!",
      action: "book",
      language: "en",
      bookStartAt: SLOT_A,
      customerName: "Sam Lee",
      serviceAddress: "12 Main St, Montréal",
      service: "Leaking tap",
      ...extra,
    });

  it("confirms only after the backend confirms, in backend wording", async () => {
    const scheduler = schedulerFake(async (r) => ({
      status: "confirmed",
      appointmentId: "appt_1",
      startAt: r.startAt,
    }));
    const h = harness({ llm: bookLlm(), scheduler, booking: true });
    const result = await h.service.handleCustomerSms(
      h.input("Yes the first one please"),
    );
    assert.equal(result.status === "replied" && result.booked, true);
    assert.equal(scheduler.reserveCalls.length, 1);
    const call = scheduler.reserveCalls[0]!;
    assert.equal(call.startAt, SLOT_A);
    assert.equal(call.callerName, "Sam Lee");
    assert.equal(call.callbackE164, CUSTOMER);
    assert.equal(call.idempotencyKey, `sms:org_1:5145551234:${SLOT_A}`);
    assert.match(h.sent[0]!.body, /confirmed/i);
    assert.doesNotMatch(h.sent[0]!.body, /Great, you're booked/);
  });

  it("offers real availability to the model and no times without a scheduler", async () => {
    const withTimes = bookLlm({ action: "reply", reply: "Which time works?" });
    const scheduler = schedulerFake(async () => ({ status: "error" }));
    const h1 = harness({ llm: withTimes, scheduler, booking: true });
    await h1.service.handleCustomerSms(h1.input("I need a plumber"));
    assert.match(withTimes.last!.user, new RegExp(`startAt=${SLOT_A}`));

    const without = bookLlm({ action: "reply", reply: "We'll check." });
    const h2 = harness({ llm: without });
    await h2.service.handleCustomerSms(h2.input("I need a plumber"));
    assert.match(without.last!.user, /AVAILABLE TIMES: none/);
  });

  it("offers alternatives when the slot was just taken and never confirms", async () => {
    const scheduler = schedulerFake(async () => ({
      status: "conflict",
      alternatives: [{ startAt: SLOT_B, endAt: "2026-10-29T19:00:00.000Z" }],
    }));
    const h = harness({ llm: bookLlm(), scheduler, booking: true });
    await h.service.handleCustomerSms(h.input("First one"));
    assert.match(h.sent[0]!.body, /just taken/i);
    assert.doesNotMatch(h.sent[0]!.body, /confirmed/i);
  });

  it("tells the customer a person will confirm when the backend errors", async () => {
    const scheduler = schedulerFake(async () => ({ status: "error" }));
    const h = harness({ llm: bookLlm(), scheduler, booking: true });
    const result = await h.service.handleCustomerSms(h.input("First one"));
    assert.equal(result.status === "replied" && result.booked, false);
    assert.doesNotMatch(h.sent[0]!.body, /confirmed|booked for/i);
    assert.match(h.sent[0]!.body, /team/i);
    assert.equal(h.escalations[0]?.reason, "booking_unconfirmed");
  });

  it("never reserves a time that was not offered", async () => {
    const scheduler = schedulerFake(async () => ({ status: "error" }));
    const h = harness({
      llm: bookLlm({ bookStartAt: "2026-10-31T10:00:00.000Z" }),
      scheduler,
      booking: true,
    });
    await h.service.handleCustomerSms(h.input("Halloween morning"));
    assert.equal(scheduler.reserveCalls.length, 0);
    assert.doesNotMatch(h.sent[0]!.body, /confirmed/i);
  });

  it("asks for name and address instead of booking without them", async () => {
    const scheduler = schedulerFake(async () => ({ status: "error" }));
    const h = harness({
      llm: bookLlm({ customerName: undefined, serviceAddress: undefined }),
      scheduler,
      booking: true,
    });
    await h.service.handleCustomerSms(h.input("First one"));
    assert.equal(scheduler.reserveCalls.length, 0);
    assert.match(h.sent[0]!.body, /name/i);
  });

  it("ignores a book action when the business has not enabled booking", async () => {
    const scheduler = schedulerFake(async () => ({ status: "error" }));
    const h = harness({ llm: bookLlm(), scheduler, booking: false });
    await h.service.handleCustomerSms(h.input("First one"));
    assert.equal(scheduler.reserveCalls.length, 0);
    assert.doesNotMatch(h.sent[0]!.body, /confirmed/i);
  });
});

describe("sms receptionist — urgency and escalation", () => {
  it("sends fixed safety guidance for a gas smell without calling the model", async () => {
    const llm = llmReturning({ reply: "x", action: "reply", language: "fr" });
    const h = harness({ llm });
    const result = await h.service.handleCustomerSms(
      h.input("Je sens une odeur de gaz dans la cuisine"),
    );
    assert.equal(llm.calls, 0);
    assert.equal(result.status === "replied" && result.source, "safety");
    assert.match(h.sent[0]!.body, /911/);
    assert.doesNotMatch(h.sent[0]!.body, /arriv|booked|confirm/i);
    assert.deepEqual(
      {
        reason: h.escalations[0]?.reason,
        hand: h.escalations[0]?.handOff,
        staff: h.escalations[0]?.alertStaff,
      },
      { reason: "urgent", hand: true, staff: true },
    );
  });

  it("hands over to the team when the model escalates", async () => {
    const llm = llmReturning({
      reply: "Je suis désolé, je transmets à l’équipe tout de suite.",
      action: "escalate",
      language: "fr",
    });
    const h = harness({ llm });
    await h.service.handleCustomerSms(
      h.input("Je veux parler à quelqu'un, c'est inacceptable"),
    );
    assert.equal(h.sent.length, 1);
    assert.equal(h.escalations[0]?.reason, "customer_request");
    assert.equal(h.escalations[0]?.handOff, true);
  });
});

describe("sms receptionist — eligibility (never reply)", () => {
  const cases: [string, Overrides, Partial<SmsReceptionistInput>, string][] = [
    [
      "automation disabled",
      { client: { aiSmsReplies: false } },
      {},
      "disabled",
    ],
    ["CRM conversation paused", {}, { paused: true }, "paused"],
    ["opted-out customer", { suppressed: true }, {}, "suppressed"],
    [
      "active missed-call workflow",
      { activeWorkflow: true },
      {},
      "active_workflow",
    ],
    ["active quote thread", {}, { quoteThreadActive: true }, "quote_thread"],
    [
      "technician texting the line",
      {},
      { fromE164: "+15145550199" },
      "staff_sender",
    ],
    [
      "technician with a different phone format",
      {},
      { fromE164: "15145550199" },
      "staff_sender",
    ],
    [
      "inactive organization",
      { org: { status: "suspended", entitled: true } },
      {},
      "organization_inactive",
    ],
    ["missing organization", { org: null }, {}, "organization_inactive"],
    [
      "plan without the feature",
      { org: { status: "active", entitled: false } },
      {},
      "not_entitled",
    ],
    ["empty body", {}, { body: "   " }, "empty_body"],
    ["missing MessageSid", {}, { messageSid: "" }, "missing_message_sid"],
  ];
  for (const [name, overrides, extra, reason] of cases) {
    it(`skips: ${name}`, async () => {
      const llm = llmReturning({ reply: "x", action: "reply", language: "fr" });
      const h = harness({ ...overrides, llm });
      const result = await h.service.handleCustomerSms(
        h.input("Bonjour", extra),
      );
      assert.deepEqual(result, { status: "skipped", reason });
      assert.equal(h.sent.length, 0);
      assert.equal(h.outbox.size, 0);
      assert.equal(llm.calls, 0);
    });
  }

  it("respects quiet hours in the business time zone and still surfaces the text", async () => {
    const h = harness({ now: NIGHT });
    const result = await h.service.handleCustomerSms(
      h.input("Bonjour, j'ai un problème"),
    );
    assert.deepEqual(result, { status: "skipped", reason: "quiet_hours" });
    assert.equal(h.sent.length, 0);
    assert.deepEqual(
      { reason: h.escalations[0]?.reason, staff: h.escalations[0]?.alertStaff },
      { reason: "quiet_hours", staff: false },
    );
  });

  it("caps automated replies per customer per hour", async () => {
    const history: HistoryMessage[] = Array.from(
      { length: MAX_AUTO_REPLIES_PER_HOUR },
      (_, i) => ({
        direction: "outbound" as const,
        body: `auto ${i}`,
        at: new Date(OPEN.getTime() - (i + 1) * 60_000).toISOString(),
        automated: true,
      }),
    );
    const h = harness({ history });
    const result = await h.service.handleCustomerSms(h.input("encore"));
    assert.deepEqual(result, { status: "skipped", reason: "rate_limited" });
    assert.equal(h.sent.length, 0);
  });
});

describe("sms receptionist — idempotency and failures", () => {
  it("sends exactly one reply when Twilio delivers the same webhook twice", async () => {
    const h = harness();
    const first = await h.service.handleCustomerSms(h.input("Bonjour"));
    const second = await h.service.handleCustomerSms(h.input("Bonjour"));
    assert.equal(first.status, "replied");
    assert.deepEqual(second, { status: "skipped", reason: "duplicate" });
    assert.equal(h.sent.length, 1);
    assert.equal(h.outbox.size, 1);
  });

  it("keeps the queued reply for retry when Twilio rejects the send", async () => {
    const h = harness({ sendFails: true });
    const result = await h.service.handleCustomerSms(h.input("Bonjour"));
    assert.equal(result.status === "replied" && result.sent, false);
    assert.deepEqual(h.failed, ["smsrep_SM_in_1"]);
    assert.equal(h.outbox.get("smsrep_SM_in_1")?.status, "queued");
    assert.deepEqual(h.crm, [
      { body: h.outbox.get("smsrep_SM_in_1")!.body, sent: false },
    ]);
  });

  it("does not send, and alerts the team, when the outbox cannot be written", async () => {
    const h = harness({ enqueueFails: true });
    const result = await h.service.handleCustomerSms(h.input("Bonjour"));
    assert.deepEqual(result, {
      status: "skipped",
      reason: "persistence_failed",
    });
    assert.equal(h.sent.length, 0);
    assert.equal(h.escalations[0]?.alertStaff, true);
    assert.ok(h.logs.some((l) => l.event === "db_failed"));
  });

  it("never throws when a dependency fails mid-flight", async () => {
    const h = harness();
    const broken = createSmsReceptionist({
      ...({} as SmsReceptionistDeps),
      now: () => OPEN,
      log: () => {},
      async getOrganization() {
        throw new Error("connection reset");
      },
    });
    const result = await broken.handleCustomerSms(h.input("Bonjour"));
    assert.deepEqual(result, { status: "skipped", reason: "unexpected_error" });
  });
});

describe("sms receptionist — logging", () => {
  it("logs ids and reasons only, never numbers, text or provider errors", async () => {
    const llm = llmReturning({
      reply: "Merci, quel est votre code postal H2X 1Y4?",
      action: "reply",
      language: "fr",
    });
    const h = harness({ llm, sendFails: true });
    await h.service.handleCustomerSms(
      h.input("Mon numéro est 514 555 1234, évier bouché secret-word"),
    );
    const dump = JSON.stringify(h.logs);
    for (const forbidden of [
      "5145551234",
      "514 555",
      "secret-word",
      "évier",
      "H2X",
      "21211",
      "+1514",
    ]) {
      assert.ok(!dump.includes(forbidden), `log leaked ${forbidden}`);
    }
    const events = h.logs.map((l) => l.event);
    for (const expected of [
      "received",
      "business_identified",
      "workflow_selected",
      "reply_generated",
      "queued",
      "send_failed",
    ]) {
      assert.ok(events.includes(expected), `missing log ${expected}`);
    }
  });
});

describe("sms receptionist — reply helpers", () => {
  it("detects French and English, keeping the prior language on ties", () => {
    assert.equal(detectLanguage("Salut, j'ai un problème", "en"), "fr");
    assert.equal(detectLanguage("Bonjour, ma toilette coule", "en"), "fr");
    assert.equal(detectLanguage("Hi, I need a quote for my roof", "fr"), "en");
    assert.equal(detectLanguage("ok", "fr"), "fr");
    assert.equal(detectLanguage("ok", "en"), "en");
  });

  it("validates model output strictly", () => {
    assert.equal(
      parseModelReply({ reply: "", action: "reply", language: "fr" }),
      null,
    );
    assert.equal(
      parseModelReply({ reply: "hi", action: "wire-money", language: "fr" }),
      null,
    );
    assert.equal(parseModelReply("not an object"), null);
    assert.deepEqual(
      parseModelReply({ reply: " hi ", action: "reply", language: "en" }),
      {
        reply: "hi",
        action: "reply",
        language: "en",
      },
    );
  });

  it("bounds reply length and strips control characters", () => {
    const long = `${"Voici une phrase. ".repeat(80)}fin`;
    const out = sanitizeReply(long)!;
    assert.ok(out.length <= MAX_REPLY_CHARS);
    assert.equal(sanitizeReply("\u0000\u0007  "), null);
    assert.equal(sanitizeReply("a\u0000b"), "ab");
  });
});
