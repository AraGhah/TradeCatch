import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanSlots,
  createAgentCallService,
} from "../../src/product/receptionist/agent-calls";
import type {
  OpenSlot,
  OpeningsResult,
  ReceptionistScheduler,
  ReserveResult,
} from "../../src/product/receptionist/booking";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

const OFFICE = "+15145550000";
const CALLER = "+15145559876";
const TZ = "America/Toronto";
// Wednesday 2026-10-21, 10:00 in Toronto (EDT).
const NOW = new Date("2026-10-21T14:00:00Z");

const slot = (startAt: string): OpenSlot => ({
  startAt,
  endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(),
});
// Thursday 9:00, Thursday 13:30, Friday 10:00 (Toronto).
const SLOTS = [
  slot("2026-10-22T13:00:00Z"),
  slot("2026-10-22T17:30:00Z"),
  slot("2026-10-23T14:00:00Z"),
];

function makeConfig(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_test",
    clientAccountId: "client_test",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "fr",
    emergencyTransferE164: "+15145550302",
    fallbackTransferE164: "+15145550303",
    notifications: [{ type: "sms", toE164: "+15145550304" }],
    phoneBooking: true,
    ...over,
  });
}

function fakeScheduler(
  over: {
    openings?: (input: Parameters<ReceptionistScheduler["listOpenings"]>[0]) => Promise<OpeningsResult>;
    reserve?: (input: Parameters<ReceptionistScheduler["reserve"]>[0]) => Promise<ReserveResult>;
  } = {},
) {
  const calls = {
    openings: [] as Parameters<ReceptionistScheduler["listOpenings"]>[0][],
    reserve: [] as Parameters<ReceptionistScheduler["reserve"]>[0][],
  };
  const scheduler: ReceptionistScheduler = {
    async listOpenings(input) {
      calls.openings.push(input);
      return (
        over.openings?.(input) ?? {
          ok: true,
          timezone: TZ,
          service: { id: "svc_1", name: "Estimation" },
          slots: SLOTS,
        }
      );
    },
    async reserve(input) {
      calls.reserve.push(input);
      return (
        over.reserve?.(input) ?? {
          status: "confirmed",
          appointmentId: "apt_1",
          startAt: input.startAt,
        }
      );
    },
  };
  return { scheduler, calls };
}

function setup(
  opts: { config?: ReceptionistConfig; scheduler?: ReceptionistScheduler } = {},
) {
  const config = opts.config ?? makeConfig();
  const store = createMemoryReceptionistStore();
  const sms = createMemorySmsPort();
  const clock = { now: () => NOW };
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms,
      sendEmail: async () => ({ sent: true }),
    }),
    clock,
  });
  const service = createAgentCallService({
    store,
    scheduler: opts.scheduler,
    finalize: engine.finalizeSession,
    clock,
  });
  return { service, store, sms, config };
}

const base = { callId: "call-abc123", fromE164: CALLER, language: "fr" as const };
const details = {
  callerName: "Marie Tremblay",
  callbackE164: CALLER,
  serviceAddress: "12 rue des Pins, Laval",
};

describe("voice agent — availability", () => {
  it("returns real openings with spoken labels in the call language", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup({ scheduler });
    const result = await service.availability(config, {
      ...base,
      preferredTime: "jeudi matin",
      issue: "chauffe-eau",
      serviceAddress: "12 rue des Pins",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.timezone, TZ);
    assert.equal(result.serviceId, "svc_1");
    assert.equal(result.matchesRequest, true);
    assert.equal(result.offers[0]!.startAt, "2026-10-22T13:00:00Z");
    assert.equal(result.offers[0]!.label, "jeudi 22 octobre à 9 h");
    for (const offer of result.offers) {
      assert.ok(SLOTS.some((s) => s.startAt === offer.startAt), "only scheduler times are offered");
    }
    assert.equal(calls.openings[0]!.language, "fr");
    assert.equal(calls.openings[0]!.issue, "chauffe-eau");
  });

  it("speaks the labels in English when the call is in English", async () => {
    const { scheduler } = fakeScheduler();
    const { service, config } = setup({ scheduler });
    const result = await service.availability(config, { ...base, language: "en" });
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.offers[0]!.label, /^Thursday, October 22 at /);
  });

  it("is off unless the owner enabled phone booking", async () => {
    const { scheduler, calls } = fakeScheduler();
    const off = setup({ scheduler, config: makeConfig({ phoneBooking: false }) });
    assert.deepEqual(await off.service.availability(off.config, base), {
      ok: false,
      reason: "booking_disabled",
    });
    const none = setup({});
    assert.deepEqual(await none.service.availability(none.config, base), {
      ok: false,
      reason: "booking_disabled",
    });
    assert.equal(calls.openings.length, 0);
  });

  it("says so when there are no openings, never inventing one", async () => {
    const { scheduler } = fakeScheduler({
      openings: async () => ({ ok: true, timezone: TZ, service: { name: "Estimation" }, slots: [] }),
    });
    const { service, config } = setup({ scheduler });
    assert.deepEqual(await service.availability(config, base), {
      ok: false,
      reason: "no_openings",
    });
  });

  it("offers the next openings, honestly, when the wished day is full", async () => {
    const { scheduler, calls } = fakeScheduler({
      openings: async (input) => ({
        ok: true,
        timezone: TZ,
        service: { id: "svc_1", name: "Estimation" },
        // A request limited to one day finds nothing; the wider search does.
        slots: input.until ? [] : SLOTS,
      }),
    });
    const { service, config } = setup({ scheduler });
    const result = await service.availability(config, { ...base, preferredTime: "jeudi matin" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.matchesRequest, false);
    assert.ok(result.offers.length > 0);
    assert.equal(calls.openings.length, 2);
    assert.equal(calls.openings[1]!.serviceId, "svc_1", "keeps the same service");
  });

  it("passes the scheduler's reason through", async () => {
    const { scheduler } = fakeScheduler({
      openings: async () => ({ ok: false, reason: "not_bookable" }),
    });
    const { service, config } = setup({ scheduler });
    assert.deepEqual(await service.availability(config, base), {
      ok: false,
      reason: "not_bookable",
    });
  });

  it("reports an unavailable calendar instead of throwing", async () => {
    const { scheduler } = fakeScheduler({
      openings: async () => {
        throw new Error("calendar down");
      },
    });
    const { service, config } = setup({ scheduler });
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await service.availability(config, base), {
        ok: false,
        reason: "unavailable",
      });
    } finally {
      console.error = originalError;
    }
  });
});

describe("voice agent — booking", () => {
  it("confirms only when the scheduler confirmed, and records it on the call", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, store, config } = setup({ scheduler });
    const result = await service.book(config, {
      ...base,
      ...details,
      startAt: "2026-10-22T13:00:00Z",
      serviceId: "svc_1",
      serviceName: "Estimation",
      timezone: TZ,
    });
    assert.deepEqual(result, {
      status: "confirmed",
      appointmentId: "apt_1",
      startAt: "2026-10-22T13:00:00.000Z",
      label: "jeudi 22 octobre à 9 h",
    });
    assert.equal(
      calls.reserve[0]!.idempotencyKey,
      "rca:call-abc123:2026-10-22T13:00:00.000Z",
      "a repeated tool call cannot book twice",
    );
    assert.equal(calls.reserve[0]!.callbackE164, CALLER);
    const session = (await store.getSessionByCallSid("lk_call-abc123"))!;
    assert.equal(session.booking?.status, "booked");
    assert.equal(session.outcome, "appointment_booked");
    assert.equal(session.slots.callerName, "Marie Tremblay");
  });

  it("asks for missing details without touching the calendar", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup({ scheduler });
    const result = await service.book(config, {
      ...base,
      startAt: "2026-10-22T13:00:00Z",
      callerName: "Marie",
      callbackE164: "not-a-number",
    });
    assert.deepEqual(result, {
      status: "missing_details",
      missing: ["callback number", "service address"],
    });
    assert.equal(calls.reserve.length, 0);
  });

  it("offers alternatives when the time was just taken, and books nothing", async () => {
    const { scheduler } = fakeScheduler({
      reserve: async () => ({ status: "conflict", alternatives: [SLOTS[1]!, SLOTS[2]!] }),
    });
    const { service, store, config } = setup({ scheduler });
    const result = await service.book(config, { ...base, ...details, startAt: SLOTS[0]!.startAt });
    assert.equal(result.status, "taken");
    if (result.status !== "taken") return;
    assert.deepEqual(
      result.offers.map((o) => o.startAt),
      [SLOTS[1]!.startAt, SLOTS[2]!.startAt],
    );
    const session = await store.getSessionByCallSid("lk_call-abc123");
    assert.equal(session?.booking, undefined);
  });

  it("never reports a booking when the scheduler fails or times out", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      for (const reserve of [
        async (): Promise<ReserveResult> => ({ status: "error" }),
        async (): Promise<ReserveResult> => {
          throw new Error("boom");
        },
      ]) {
        const { scheduler } = fakeScheduler({ reserve });
        const { service, store, config } = setup({ scheduler });
        const result = await service.book(config, { ...base, ...details, startAt: SLOTS[0]!.startAt });
        assert.deepEqual(result, { status: "error", reason: "reserve_failed" });
        assert.equal((await store.getSessionByCallSid("lk_call-abc123"))?.booking, undefined);
      }
    } finally {
      console.error = original;
    }
  });

  it("passes a plain request through as a request", async () => {
    const { scheduler } = fakeScheduler({
      reserve: async () => ({ status: "request", reason: "outside_hours" }),
    });
    const { service, config } = setup({ scheduler });
    assert.deepEqual(
      await service.book(config, { ...base, ...details, startAt: SLOTS[0]!.startAt }),
      { status: "request", reason: "outside_hours" },
    );
  });

  it("rejects a time that is not a date and a disabled booking line", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup({ scheduler });
    assert.deepEqual(await service.book(config, { ...base, ...details, startAt: "tomorrow-ish" }), {
      status: "error",
      reason: "invalid_time",
    });
    const off = setup({ scheduler, config: makeConfig({ phoneBooking: false }) });
    assert.deepEqual(await off.service.book(off.config, { ...base, ...details, startAt: SLOTS[0]!.startAt }), {
      status: "request",
      reason: "booking_disabled",
    });
    assert.equal(calls.reserve.length, 0);
  });
});

describe("voice agent — the finished call", () => {
  const transcript = [
    { speaker: "caller" as const, text: "J'ai une fuite sous l'évier" },
    { speaker: "agent" as const, text: "Je prends votre demande." },
  ];

  it("becomes a normal call record with the usual summary and notifications", async () => {
    const { service, store, sms, config } = setup({});
    const session = await service.report(config, {
      ...base,
      intent: "service_request",
      slots: { ...details, issue: "fuite sous l'évier", preferredTime: "demain matin" },
      transcript,
      durationSeconds: 95,
      endReason: "completed",
    });
    assert.ok(session?.finalizedAt);
    assert.equal(session!.outcome, "message_taken");
    assert.equal(session!.status, "completed");
    assert.equal(session!.language, "fr");
    assert.equal(session!.durationSeconds, 95);
    assert.equal(session!.callerTurnCount, 1);
    assert.equal(session!.slots.callerName, "Marie Tremblay");
    assert.ok(session!.summary);
    assert.equal(sms.sent.length, 1);
    assert.match(sms.sent[0]!.body, /Marie Tremblay/);
    assert.equal((await store.listSessions({})).length, 1);
  });

  it("is safe to send twice: one record, one notification", async () => {
    const { service, store, sms, config } = setup({});
    const input = {
      ...base,
      slots: { ...details, issue: "fuite" },
      transcript,
      endReason: "completed" as const,
    };
    await Promise.all([service.report(config, input), service.report(config, input)]);
    await service.report(config, input);
    assert.equal((await store.listSessions({})).length, 1);
    assert.equal(sms.sent.length, 1);
  });

  it("calls it booked only when the book tool recorded it", async () => {
    const { scheduler } = fakeScheduler();
    const { service, config } = setup({ scheduler });
    await service.book(config, { ...base, ...details, startAt: SLOTS[0]!.startAt });
    const session = await service.report(config, {
      ...base,
      slots: { issue: "estimation" },
      transcript,
      endReason: "completed",
    });
    assert.equal(session!.outcome, "appointment_booked");
  });

  it("does not call it booked because the transcript says so", async () => {
    const { service, config } = setup({ scheduler: fakeScheduler().scheduler });
    const session = await service.report(config, {
      ...base,
      intent: "appointment",
      slots: { issue: "estimation", preferredTime: "jeudi matin" },
      transcript: [
        ...transcript,
        { speaker: "agent", text: "Parfait, votre rendez-vous est confirmé pour jeudi à 9 h." },
      ],
      endReason: "completed",
    });
    assert.notEqual(session!.outcome, "appointment_booked");
    assert.equal(session!.outcome, "appointment_requested");
    assert.equal(session!.booking, undefined);
  });

  it("records a completed transfer and an emergency", async () => {
    const { service, config } = setup({});
    const session = await service.report(config, {
      ...base,
      slots: { issue: "fuite de gaz" },
      transfer: { targetName: "Emergency", completed: true },
      emergency: true,
      endReason: "completed",
    });
    assert.equal(session!.outcome, "emergency_transferred");
    assert.equal(session!.urgency?.level, "critical");
    assert.equal(session!.transfers[0]?.status, "completed");
  });

  it("keeps a failed transfer as a failed transfer, not as a handoff", async () => {
    const { service, config } = setup({});
    const session = await service.report(config, {
      ...base,
      slots: { issue: "facture" },
      transfer: { targetName: "Billing", completed: false },
      endReason: "completed",
    });
    assert.equal(session!.outcome, "message_taken");
    assert.equal(session!.transfers[0]?.status, "failed");
  });

  it("marks a call with nothing in it as hung up, and an agent error as failed", async () => {
    const { service, config } = setup({});
    const empty = await service.report(config, { ...base, callId: "call-empty1", endReason: "caller_hung_up" });
    assert.equal(empty!.outcome, "caller_hung_up");
    const failed = await service.report(config, { ...base, callId: "call-failed", endReason: "error" });
    assert.equal(failed!.status, "failed");
  });

  it("keeps only the language of the call and never trusts a malformed number", async () => {
    const { service, config } = setup({});
    const session = await service.report(config, {
      ...base,
      language: "en",
      slots: { issue: "leak", callbackE164: "(514) 555-0199" },
    });
    assert.equal(session!.language, "en");
    assert.equal(session!.slots.callbackE164, undefined);
  });
});

describe("voice agent — slot cleaning", () => {
  it("trims, bounds and validates what the model supplied", () => {
    const slots = cleanSlots({
      callerName: `  ${"x".repeat(200)}  `,
      issue: "  fuite\n\n d'eau  ",
      callbackE164: "+15145550199",
      email: "marie@example.com",
      service: "",
    });
    assert.equal(slots.callerName!.length, 80);
    assert.equal(slots.issue, "fuite d'eau");
    assert.equal(slots.callbackE164, "+15145550199");
    assert.equal(slots.email, "marie@example.com");
    assert.equal("service" in slots, false);
    assert.deepEqual(cleanSlots(undefined), {});
    assert.equal(cleanSlots({ callbackE164: "514" }).callbackE164, undefined);
    assert.equal(
      cleanSlots({ issue: "y".repeat(5000) }).issue!.length,
      600,
    );
  });
});
