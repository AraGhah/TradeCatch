import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CallOwnershipError,
  createAgentCallService,
} from "../../src/product/receptionist/agent-calls";
import {
  agentAvailability,
  agentBook,
  agentAppointments,
  agentDetails,
} from "../../src/product/receptionist/agent-operations";
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
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

const OFFICE = "+15145550000";
const CALLER = "+15145559876";
const NOW = new Date("2026-10-21T14:00:00Z");
const slot = (startAt: string): OpenSlot => ({
  startAt,
  endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(),
});
const SLOTS = [slot("2026-10-22T13:00:00Z"), slot("2026-10-23T14:00:00Z")];

const config = (over: Record<string, unknown> = {}) =>
  parseReceptionistConfig({
    id: "rc_bland",
    clientAccountId: "client_bland",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "en",
    notifications: [],
    phoneBooking: true,
    ...over,
  });

function harness(reserve?: () => Promise<ReserveResult>) {
  const calls = { openings: 0, reserve: [] as Parameters<ReceptionistScheduler["reserve"]>[0][] };
  const scheduler: ReceptionistScheduler = {
    async listOpenings() {
      calls.openings += 1;
      return {
        ok: true,
        timezone: "America/Toronto",
        service: { id: "svc_1", name: "Visit" },
        slots: SLOTS,
      };
    },
    async reserve(input) {
      calls.reserve.push(input);
      return (
        (await reserve?.()) ?? {
          status: "confirmed",
          appointmentId: "appt_1",
          startAt: input.startAt,
        }
      );
    },
  };
  const store = createMemoryReceptionistStore();
  const clock = { now: () => NOW };
  const engine = createReceptionistEngine({
    store,
    configs: () => [config()],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms: createMemorySmsPort(),
      sendEmail: async () => ({ sent: true }),
    }),
    clock,
  });
  const agentCalls = createAgentCallService({
    store,
    scheduler,
    finalize: engine.finalizeSession,
    notifyTransferFailed: async () => undefined,
    clock,
  });
  return { agentCalls, store, calls };
}

type Provider = "google" | "calcom" | null;
const runtimeOf = (
  h: ReturnType<typeof harness>,
  provider: Provider,
  appointments: Record<string, unknown> = {},
) =>
  ({
    bookingProvider: async () => provider,
    agentCalls: h.agentCalls,
    agentAppointments: appointments,
  }) as never;

const ids = { callId: "bland-call-0001", from: CALLER, language: "en" as const, number: OFFICE };

describe("Bland operations: nothing is booked without a real provider", () => {
  it("offers no times when no provider is connected, and never asks the scheduler", async () => {
    const h = harness();
    const out = await agentAvailability({
      config: config(),
      body: { ...ids },
      runtime: runtimeOf(h, null),
      channel: "bland",
      requireLiveProvider: true,
    });
    assert.deepEqual(out, { availability: { ok: false, reason: "booking_disabled" } });
    assert.equal(h.calls.openings, 0);
  });

  it("never confirms a booking when no provider is connected (no simulated appointment)", async () => {
    const h = harness();
    const out = await agentBook({
      config: config(),
      body: {
        ...ids,
        startAt: SLOTS[0].startAt,
        callerName: "Jean Tremblay",
        serviceAddress: "123 Rue Principale, Laval",
      },
      runtime: runtimeOf(h, null),
      channel: "bland",
      requireLiveProvider: true,
    });
    assert.deepEqual(out, { booking: { status: "request", reason: "booking_disabled" } });
    assert.equal(h.calls.reserve.length, 0, "the scheduler was never asked to reserve");
  });

  it("move and cancel are refused without a provider, so nothing is reported as changed", async () => {
    const h = harness();
    const called: string[] = [];
    const runtime = runtimeOf(h, null, {
      move: async () => called.push("move"),
      cancel: async () => called.push("cancel"),
    });
    const common = { config: config(), runtime, channel: "bland" as const, requireLiveProvider: true };
    for (const body of [
      { ...ids, action: "move" as const, appointmentId: "a1", startAt: SLOTS[0].startAt },
      { ...ids, action: "cancel" as const, appointmentId: "a1" },
    ]) {
      assert.deepEqual(await agentAppointments({ ...common, body }), { result: { status: "disabled" } });
    }
    assert.deepEqual(called, []);
  });

  for (const provider of ["calcom", "google"] as const) {
    it(`with ${provider} connected, a confirmed reservation is reported confirmed`, async () => {
      const h = harness();
      const out = await agentBook({
        config: config(),
        body: {
          ...ids,
          startAt: SLOTS[0].startAt,
          callerName: "Jean Tremblay",
          serviceAddress: "123 Rue Principale, Laval",
        },
        runtime: runtimeOf(h, provider),
        channel: "bland",
        requireLiveProvider: true,
      });
      assert.equal((out.booking as { status: string }).status, "confirmed");
      assert.equal(h.calls.reserve.length, 1);
    });
  }

  it("a time the provider no longer has comes back as taken with other times, never confirmed", async () => {
    const h = harness(async () => ({ status: "conflict", alternatives: SLOTS }));
    const out = await agentBook({
      config: config(),
      body: {
        ...ids,
        startAt: SLOTS[0].startAt,
        callerName: "Jean Tremblay",
        serviceAddress: "123 Rue Principale, Laval",
      },
      runtime: runtimeOf(h, "calcom"),
      channel: "bland",
      requireLiveProvider: true,
    });
    const booking = out.booking as { status: string; offers: unknown[] };
    assert.equal(booking.status, "taken");
    assert.ok(booking.offers.length > 0);
  });

  it("an unconfirmed result (provider outcome unknown) is a request, not a booking", async () => {
    const h = harness(async () => ({ status: "request", reason: "calendar_unknown" }));
    const out = await agentBook({
      config: config(),
      body: {
        ...ids,
        startAt: SLOTS[0].startAt,
        callerName: "Jean Tremblay",
        serviceAddress: "123 Rue Principale, Laval",
      },
      runtime: runtimeOf(h, "calcom"),
      channel: "bland",
      requireLiveProvider: true,
    });
    assert.deepEqual(out, { booking: { status: "request", reason: "calendar_unknown" } });
  });
});

describe("Bland operations: details survive the call", () => {
  it("booking uses what was saved earlier and the caller's own number", async () => {
    const h = harness();
    const runtime = runtimeOf(h, "calcom");
    const common = { config: config(), runtime, channel: "bland" as const, requireLiveProvider: true };
    const saved = await agentDetails({
      ...common,
      body: {
        ...ids,
        slots: {
          callerName: "Jean Tremblay",
          serviceAddress: "123 Rue Principale, Laval, QC H7N 1A1",
        },
      },
    });
    assert.deepEqual(saved, { result: { saved: ["callerName", "serviceAddress"] } });
    // The booking tool call carries no details at all.
    await agentBook({ ...common, body: { ...ids, startAt: SLOTS[0].startAt } });
    const sent = h.calls.reserve[0];
    assert.equal(sent.callerName, "Jean Tremblay");
    assert.equal(sent.serviceAddress, "123 Rue Principale, Laval, QC H7N 1A1");
    assert.equal(sent.callbackE164, CALLER);
  });

  it("an incomplete address does not replace a confirmed one", async () => {
    const h = harness();
    const runtime = runtimeOf(h, "calcom");
    const common = { config: config(), runtime, channel: "bland" as const, requireLiveProvider: true };
    await agentDetails({
      ...common,
      body: { ...ids, slots: { callerName: "Jean", serviceAddress: "123 Rue Principale, Laval" } },
    });
    await agentBook({
      ...common,
      body: { ...ids, startAt: SLOTS[0].startAt, serviceAddress: "Laval" },
    });
    assert.equal(h.calls.reserve[0].serviceAddress, "123 Rue Principale, Laval");
  });

  it("a street with no number is asked for again rather than booked", async () => {
    const h = harness();
    const out = await agentBook({
      config: config(),
      body: { ...ids, startAt: SLOTS[0].startAt, callerName: "Jean", serviceAddress: "Laval" },
      runtime: runtimeOf(h, "calcom"),
      channel: "bland",
      requireLiveProvider: true,
    });
    const booking = out.booking as { status: string; missing: string[] };
    assert.equal(booking.status, "missing_details");
    assert.match(booking.missing.join(" "), /street number/);
    assert.equal(h.calls.reserve.length, 0);
  });

  it("a city given separately is added to the street", async () => {
    const h = harness();
    const runtime = runtimeOf(h, "calcom");
    const common = { config: config(), runtime, channel: "bland" as const, requireLiveProvider: true };
    await agentDetails({
      ...common,
      body: { ...ids, slots: { callerName: "Jean", serviceAddress: "123 Rue Principale", location: "Laval" } },
    });
    await agentBook({ ...common, body: { ...ids, startAt: SLOTS[0].startAt } });
    assert.equal(h.calls.reserve[0].serviceAddress, "123 Rue Principale, Laval");
  });

  it("an address is tidied: one line, postal code in standard form", async () => {
    const h = harness();
    await agentDetails({
      config: config(),
      body: { ...ids, slots: { serviceAddress: "  123  Rue Principale ,\nLaval  h7n1a1 " } },
      runtime: runtimeOf(h, "calcom"),
      channel: "bland",
    });
    await agentBook({
      config: config(),
      body: { ...ids, startAt: SLOTS[0].startAt, callerName: "Jean" },
      runtime: runtimeOf(h, "calcom"),
      channel: "bland",
      requireLiveProvider: true,
    });
    assert.equal(h.calls.reserve[0].serviceAddress, "123 Rue Principale, Laval H7N 1A1");
  });
});

describe("Bland operations: calls belong to one business", () => {
  it("a call id used on one business's line cannot be used on another's", async () => {
    const h = harness();
    const a = config();
    const b = config({ id: "rc_other", clientAccountId: "client_other", phoneNumberE164: "+15145550999" });
    await agentDetails({
      config: a,
      body: { ...ids, slots: { callerName: "Jean" } },
      runtime: runtimeOf(h, "calcom"),
      channel: "bland",
    });
    await assert.rejects(
      agentDetails({
        config: b,
        body: { ...ids, slots: { callerName: "Mallory" } },
        runtime: runtimeOf(h, "calcom"),
        channel: "bland",
      }),
      CallOwnershipError,
    );
  });

  it("the same raw call id on the LiveKit path and the Bland path are separate calls", async () => {
    const h = harness();
    const runtime = runtimeOf(h, "calcom");
    await agentDetails({ config: config(), body: { ...ids, slots: { callerName: "A" } }, runtime, channel: "bland" });
    await agentDetails({ config: config(), body: { ...ids, slots: { callerName: "B" } }, runtime, channel: "livekit" });
    assert.ok(await h.store.getSessionByCallSid("bl_bland-call-0001"));
    assert.ok(await h.store.getSessionByCallSid("lk_bland-call-0001"));
  });
});
