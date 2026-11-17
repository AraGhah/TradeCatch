import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CallTenantMismatchError,
  createAgentCallService,
} from "../../src/product/receptionist/agent-calls";
import type {
  OpenSlot,
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
const NOW = new Date("2026-10-21T14:00:00Z");

const slot = (startAt: string): OpenSlot => ({
  startAt,
  endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(),
});
const SLOTS = [slot("2026-10-22T13:00:00Z"), slot("2026-10-22T17:30:00Z")];

function makeConfig(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_bland",
    clientAccountId: "client_bland",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "fr",
    notifications: [],
    phoneBooking: true,
    ...over,
  });
}

function fakeScheduler(
  reserve?: (input: Parameters<ReceptionistScheduler["reserve"]>[0]) => ReserveResult,
) {
  const calls: Parameters<ReceptionistScheduler["reserve"]>[0][] = [];
  const scheduler: ReceptionistScheduler = {
    async listOpenings() {
      return {
        ok: true,
        timezone: TZ,
        service: { id: "svc_1", name: "Estimation" },
        slots: SLOTS,
      };
    },
    async reserve(input) {
      calls.push(input);
      return (
        reserve?.(input) ?? {
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
  channel: "bland" | "livekit" = "bland",
  scheduler?: ReceptionistScheduler,
  config = makeConfig(),
) {
  const store = createMemoryReceptionistStore();
  const clock = { now: () => NOW };
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms: createMemorySmsPort(),
      sendEmail: async () => ({ sent: true }),
    }),
    clock,
  });
  const service = createAgentCallService({
    store,
    scheduler,
    finalize: engine.finalizeSession,
    clock,
    channel,
  });
  return { service, store, config };
}

const base = { callId: "call-bland-1", fromE164: CALLER, language: "fr" as const };
const START = "2026-10-22T13:00:00Z";

describe("Bland call service", () => {
  it("keeps Bland calls apart from LiveKit calls with the same id", async () => {
    const store = createMemoryReceptionistStore();
    const config = makeConfig();
    const make = (channel: "bland" | "livekit") =>
      createAgentCallService({
        store,
        finalize: async () => null,
        clock: { now: () => NOW },
        channel,
      });
    await make("bland").recordSlots(config, { ...base, slots: { issue: "a" } });
    await make("livekit").recordSlots(config, { ...base, slots: { issue: "b" } });
    assert.equal((await store.getSessionByCallSid("bl_call-bland-1"))?.slots.issue, "a");
    assert.equal((await store.getSessionByCallSid("lk_call-bland-1"))?.slots.issue, "b");
  });

  it("uses its own idempotency key so a repeated tool call books once", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup("bland", scheduler);
    await service.saveDetails(config, {
      ...base,
      callerName: "Marie Tremblay",
      useCallerId: true,
      address: { address: "12 rue des Pins, Laval, QC H7N 1A1" },
    });
    const first = await service.book(config, { ...base, startAt: START, strictAddress: true });
    const second = await service.book(config, { ...base, startAt: START, strictAddress: true });
    assert.equal(first.status, "confirmed");
    assert.equal(second.status, "confirmed");
    assert.equal(calls[0]!.idempotencyKey, "rcb:call-bland-1:2026-10-22T13:00:00.000Z");
    assert.equal(
      calls[0]!.idempotencyKey,
      calls[1]!.idempotencyKey,
      "the scheduler dedupes on this key",
    );
  });

  it("refuses a call id that already belongs to another business", async () => {
    const { service, config } = setup("bland");
    await service.recordSlots(config, { ...base, slots: { issue: "x" } });
    const other = makeConfig({ id: "rc_other", clientAccountId: "client_other" });
    await assert.rejects(
      service.recordSlots(other, { ...base, slots: { issue: "y" } }),
      CallTenantMismatchError,
    );
  });
});

describe("confirmed caller details", () => {
  it("saves the address in canonical form and says what is still missing", async () => {
    const { service, config } = setup();
    const saved = await service.saveDetails(config, {
      ...base,
      callerName: "Marie Tremblay",
      address: { street: "12 rue des Pins", city: "Laval", province: "Québec", postalCode: "h7n1a1" },
    });
    assert.equal(saved.status, "saved");
    assert.equal(saved.confirmed.serviceAddress, "12 rue des Pins, Laval, QC H7N 1A1");
    assert.deepEqual(saved.missing, ["callback number"]);
    assert.equal(saved.address?.status, "complete");
  });

  it("does not save an incomplete address, and says which part is missing", async () => {
    const { service, config } = setup();
    const saved = await service.saveDetails(config, {
      ...base,
      address: { address: "12 rue des Pins, Laval" },
    });
    assert.equal(saved.status, "rejected");
    assert.deepEqual(saved.rejected, ["serviceAddress"]);
    assert.deepEqual(saved.address?.missing, ["province"]);
    assert.equal(saved.address?.understood?.city, "Laval");
    assert.equal(saved.confirmed.serviceAddress, undefined);
  });

  it("uses the caller ID only when asked, and never an unreadable number", async () => {
    const { service, config } = setup();
    const ok = await service.saveDetails(config, { ...base, useCallerId: true });
    assert.equal(ok.confirmed.callbackE164, CALLER);
    const hidden = setup();
    const withheld = await hidden.service.saveDetails(hidden.config, {
      callId: "call-hidden-1",
      fromE164: undefined,
      language: "fr",
      useCallerId: true,
    });
    assert.deepEqual(withheld.rejected, ["callbackE164"]);
    assert.equal(withheld.confirmed.callbackE164, undefined);
  });

  it("books with the saved details: nothing has to be repeated", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup("bland", scheduler);
    await service.saveDetails(config, {
      ...base,
      callerName: "Marie Tremblay",
      callbackPhone: "514 555 9876",
      address: { address: "12 rue des Pins, Laval, QC H7N 1A1" },
    });
    const booked = await service.book(config, { ...base, startAt: START, strictAddress: true });
    assert.equal(booked.status, "confirmed");
    assert.equal(calls[0]!.callerName, "Marie Tremblay");
    assert.equal(calls[0]!.callbackE164, CALLER);
    assert.equal(calls[0]!.serviceAddress, "12 rue des Pins, Laval, QC H7N 1A1");
  });

  it("does not book on a disagreement with what the caller confirmed", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup("bland", scheduler);
    await service.saveDetails(config, {
      ...base,
      callerName: "Marie Tremblay",
      useCallerId: true,
      address: { address: "12 rue des Pins, Laval, QC H7N 1A1" },
    });
    const result = await service.book(config, {
      ...base,
      startAt: START,
      callerName: "Paul Dupont",
      serviceAddress: "99 boulevard Curé-Labelle, Laval, QC H7P 2P4",
    });
    assert.equal(result.status, "details_conflict");
    if (result.status === "details_conflict") {
      assert.deepEqual(result.fields, ["callerName", "serviceAddress"]);
      assert.equal(result.confirmed.callerName, "Marie Tremblay");
    }
    assert.equal(calls.length, 0, "nothing reached the calendar");
  });

  it("a differently spelled copy of the same detail is not a conflict", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup("bland", scheduler);
    await service.saveDetails(config, {
      ...base,
      callerName: "Marie Tremblay",
      useCallerId: true,
      address: { address: "12 rue des Pins, Laval, QC H7N 1A1" },
    });
    const result = await service.book(config, {
      ...base,
      startAt: START,
      callerName: "marie  TREMBLAY",
      serviceAddress: "12, Rue des Pins Laval QC H7N 1A1",
    });
    assert.equal(result.status, "confirmed");
    assert.equal(calls[0]!.callerName, "Marie Tremblay", "the confirmed spelling is what is stored");
  });

  it("strict mode drops an incomplete address instead of storing it", async () => {
    const { scheduler, calls } = fakeScheduler();
    const { service, config } = setup("bland", scheduler);
    const result = await service.book(config, {
      ...base,
      startAt: START,
      callerName: "Marie",
      callbackE164: CALLER,
      serviceAddress: "chez moi",
      strictAddress: true,
    });
    assert.equal(result.status, "missing_details");
    if (result.status === "missing_details") {
      assert.deepEqual(result.missing, ["service address"]);
      assert.equal(result.address?.status, "incomplete");
    }
    assert.equal(calls.length, 0);
  });

  it("later notes and the final report never replace what was confirmed", async () => {
    const { service, store, config } = setup();
    await service.saveDetails(config, {
      ...base,
      callerName: "Marie Tremblay",
      useCallerId: true,
      address: { address: "12 rue des Pins, Laval, QC H7N 1A1" },
    });
    const noted = await service.recordSlots(config, {
      ...base,
      slots: { callerName: "Mary T", serviceAddress: "somewhere else", issue: "fuite" },
    });
    assert.deepEqual(noted.fields, ["issue"], "only the unconfirmed field was taken");
    await service.report(config, {
      ...base,
      intent: "service_request",
      slots: { callerName: "Mary", serviceAddress: "1 other road" },
      transcript: [{ speaker: "caller", text: "Bonjour" }],
      endReason: "completed",
    });
    const session = (await store.getSessionByCallSid("bl_call-bland-1"))!;
    assert.equal(session.slots.callerName, "Marie Tremblay");
    assert.equal(session.slots.serviceAddress, "12 rue des Pins, Laval, QC H7N 1A1");
    assert.equal(session.slots.issue, "fuite");
    assert.ok(session.finalizedAt);
  });

  it("a finished call takes no more notes", async () => {
    const { service, config } = setup();
    await service.report(config, { ...base, endReason: "completed" });
    const late = await service.recordSlots(config, { ...base, slots: { issue: "late" } });
    assert.deepEqual(late, { recorded: false, fields: [] });
  });
});

describe("business privacy setting: call transcripts (Bland and LiveKit)", () => {
  const TRANSCRIPT = [
    { speaker: "agent" as const, text: "Nord Plomberie, bonjour." },
    { speaker: "caller" as const, text: "J'ai une fuite sous l'évier." },
  ];

  for (const channel of ["bland", "livekit"] as const) {
    const prefix = channel === "bland" ? "bl_" : "lk_";

    it(`${channel}: transcripts off drops the turns but keeps the summary and outcome`, async () => {
      const config = { ...makeConfig(), saveCallTranscripts: false };
      const { service, store } = setup(channel, undefined, config);
      await service.report(config, {
        ...base,
        intent: "service_request",
        slots: { callerName: "Marie Tremblay", issue: "fuite" },
        transcript: TRANSCRIPT,
        endReason: "completed",
      });
      const session = (await store.getSessionByCallSid(`${prefix}call-bland-1`))!;
      assert.ok(session.finalizedAt);
      assert.deepEqual(session.turns, []);
      assert.ok(session.transcriptPurgedAt);
      assert.equal(session.slots.callerName, "Marie Tremblay");
      assert.ok(session.summary, "the owner's summary is still built");
    });

    it(`${channel}: transcripts on (and the default) keep the turns`, async () => {
      for (const over of [{ saveCallTranscripts: true }, {}]) {
        const config = { ...makeConfig(), ...over };
        const { service, store } = setup(channel, undefined, config);
        await service.report(config, {
          ...base,
          intent: "service_request",
          slots: { callerName: "Marie Tremblay", issue: "fuite" },
          transcript: TRANSCRIPT,
          endReason: "completed",
        });
        const session = (await store.getSessionByCallSid(`${prefix}call-bland-1`))!;
        assert.equal(session.turns.length, 2, JSON.stringify(over));
        assert.equal(session.transcriptPurgedAt, undefined);
      }
    });
  }
});
