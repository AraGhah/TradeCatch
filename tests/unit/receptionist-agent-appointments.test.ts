import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callerOwnsAppointment,
  callerTextId,
  createAgentAppointmentService,
  hoursForText,
  type CallerTextPort,
} from "../../src/product/receptionist/agent-appointments";
import { SmsDeliveryError } from "../../src/product/missed-call/twilio";
import type { OutboundMessageRecord } from "../../src/product/missed-call/types";
import type { SchedulingService } from "../../src/product/scheduling/service";
import type { ScheduleAppointment } from "../../src/product/scheduling/types";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";

const NOW = new Date("2026-11-04T15:00:00Z");
const CALLER = "+15145551234";

const config = {
  id: "rc_test",
  clientAccountId: "client_test",
  phoneNumberE164: "+14385550100",
  businessName: "Plomberie Nord",
  businessAddress: "12 rue Principale, Laval",
  businessPhone: "450 555-0100",
  businessHours: { start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] },
  timezone: "America/Toronto",
  phoneBooking: true,
  smsFromE164: "+14385550199",
} as unknown as ReceptionistConfig;

function appointment(over: Partial<ScheduleAppointment>): ScheduleAppointment {
  return {
    id: "appt_1",
    organizationId: "org_1",
    customerName: "Hélène Tremblay",
    customerPhoneE164: CALLER,
    serviceAddress: "45 rue Secrète, Montréal",
    serviceId: "svc_1",
    serviceName: "Débouchage",
    technicianName: "Marc Gagnon",
    startAt: "2026-11-06T14:00:00Z",
    endAt: "2026-11-06T15:00:00Z",
    timezone: "America/Toronto",
    status: "confirmed",
    bookingSource: "ai_receptionist",
    appointmentKind: "job",
    simulated: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

function setup(rows: ScheduleAppointment[], options: { texts?: CallerTextPort } = {}) {
  const calls = { reschedule: [] as string[], cancel: [] as string[] };
  const scheduling = {
    async list() {
      return rows;
    },
    async get(_org: string, id: string) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("Appointment not found.");
      return { appointment: row, history: [] };
    },
    async reschedule(_org: string, id: string, startAt: string) {
      calls.reschedule.push(`${id}@${startAt}`);
      const row = rows.find((r) => r.id === id)!;
      if (startAt.startsWith("2026-11-09")) {
        return {
          ok: false as const,
          confirmed: false,
          reason: "conflict",
          alternatives: [{ startAt: "2026-11-10T14:00:00Z", endAt: "2026-11-10T15:00:00Z" }],
          appointment: row,
        };
      }
      return { ok: true as const, confirmed: true, appointment: { ...row, startAt }, alternatives: [] };
    },
    async cancel(_org: string, id: string) {
      calls.cancel.push(id);
      return { ok: true as const, appointment: rows.find((r) => r.id === id)! };
    },
  } as unknown as SchedulingService;
  const service = createAgentAppointmentService({
    scheduling: async () => scheduling,
    findOrganizationId: async () => "org_1",
    texts: options.texts,
    clock: { now: () => NOW },
  });
  return { service, calls };
}

function textPort(opts: { suppressed?: boolean; fail?: unknown } = {}) {
  const queued = new Map<string, OutboundMessageRecord>();
  const sent: OutboundMessageRecord[] = [];
  const failed: string[] = [];
  const port: CallerTextPort = {
    async sender(c) {
      return c.smsFromE164 ? { fromE164: c.smsFromE164 } : null;
    },
    async isSuppressed() {
      return Boolean(opts.suppressed);
    },
    async enqueue(message) {
      if (!queued.has(message.id)) queued.set(message.id, { ...message });
    },
    async claim(id) {
      const row = queued.get(id);
      if (!row || row.status !== "queued") return null;
      row.status = "sending";
      return row;
    },
    async send(message) {
      if (opts.fail) throw opts.fail;
      sent.push(message as unknown as OutboundMessageRecord);
      return { sid: `SM${sent.length}` };
    },
    async markSent(id) {
      queued.get(id)!.status = "sent";
    },
    async markFailed(id) {
      failed.push(id);
    },
  };
  return { port, queued, sent, failed };
}

describe("who owns an appointment", () => {
  it("needs the same phone number and one matching word of the name", () => {
    const a = appointment({});
    assert.equal(callerOwnsAppointment(a, CALLER, "helene"), true, "accents and case do not matter");
    assert.equal(callerOwnsAppointment(a, "+1 514 555 1234", "Tremblay"), true);
    assert.equal(callerOwnsAppointment(a, CALLER, "Robert"), false, "wrong name");
    assert.equal(callerOwnsAppointment(a, CALLER, undefined), false, "no name given");
    assert.equal(callerOwnsAppointment(a, "+15145559999", "Hélène"), false, "other number");
    assert.equal(
      callerOwnsAppointment(appointment({ customerPhoneE164: undefined }), CALLER, "Hélène"),
      false,
      "an appointment without a phone is never matched",
    );
  });
});

describe("find", () => {
  it("returns only the caller's own upcoming appointments, without address or phone", async () => {
    const { service } = setup([
      appointment({ id: "mine_later", startAt: "2026-11-12T14:00:00Z" }),
      appointment({ id: "mine_soon" }),
      appointment({ id: "mine_today_late", startAt: "2026-11-04T13:00:00Z" }),
      appointment({ id: "mine_canceled", status: "canceled" }),
      appointment({ id: "mine_old", startAt: "2026-10-01T14:00:00Z" }),
      appointment({ id: "neighbour", customerPhoneE164: "+15145550000", customerName: "Hélène Roy" }),
    ]);
    const found = await service.find(config, { callerE164: CALLER, callerName: "Hélène", language: "fr" });
    assert.equal(found.status, "found");
    assert.ok(found.status === "found");
    assert.deepEqual(
      found.appointments.map((a) => a.appointmentId),
      ["mine_today_late", "mine_soon", "mine_later"],
    );
    assert.equal(found.appointments[0]!.started, true, "a start time that passed is flagged");
    assert.equal(found.appointments[1]!.technicianName, "Marc", "first name only");
    const text = JSON.stringify(found);
    assert.doesNotMatch(text, /Secrète|5551234|Gagnon/, "no address, phone or technician surname");
  });

  it("asks for a name, refuses a hidden number, and reveals nothing for a wrong name", async () => {
    const { service } = setup([appointment({})]);
    assert.deepEqual(await service.find(config, { callerE164: CALLER, language: "fr" }), { status: "name_needed" });
    assert.deepEqual(
      await service.find(config, { callerE164: "anonymous", callerName: "Hélène", language: "fr" }),
      { status: "caller_unknown" },
    );
    assert.deepEqual(
      await service.find(config, { callerE164: CALLER, callerName: "Robert", language: "fr" }),
      { status: "not_found" },
    );
  });

  it("is off when the business did not turn on phone booking", async () => {
    const { service } = setup([appointment({})]);
    const off = { ...config, phoneBooking: false } as ReceptionistConfig;
    assert.deepEqual(
      await service.find(off, { callerE164: CALLER, callerName: "Hélène", language: "fr" }),
      { status: "disabled" },
    );
  });
});

describe("move and cancel", () => {
  it("moves the caller's own appointment and reads back the new time", async () => {
    const { service, calls } = setup([appointment({})]);
    const moved = await service.move(config, {
      callerE164: CALLER,
      callerName: "Tremblay",
      appointmentId: "appt_1",
      startAt: "2026-11-11T15:00:00Z",
      language: "en",
    });
    assert.equal(moved.status, "moved");
    assert.deepEqual(calls.reschedule, ["appt_1@2026-11-11T15:00:00.000Z"]);
  });

  it("offers the real alternatives when the new time was taken", async () => {
    const { service } = setup([appointment({})]);
    const taken = await service.move(config, {
      callerE164: CALLER,
      callerName: "Hélène",
      appointmentId: "appt_1",
      startAt: "2026-11-09T15:00:00Z",
      language: "fr",
    });
    assert.equal(taken.status, "taken");
    assert.ok(taken.status === "taken" && taken.offers.length === 1);
  });

  it("never touches someone else's appointment, even with its id", async () => {
    const { service, calls } = setup([appointment({ customerPhoneE164: "+15145550000" })]);
    const input = { callerE164: CALLER, callerName: "Hélène", appointmentId: "appt_1" };
    assert.deepEqual(
      await service.move(config, { ...input, startAt: "2026-11-11T15:00:00Z", language: "fr" }),
      { status: "not_found" },
    );
    assert.deepEqual(await service.cancel(config, input), { status: "not_found" });
    assert.equal(await service.forRescheduling(config, input), null);
    assert.deepEqual(calls, { reschedule: [], cancel: [] });
  });

  it("cancels the caller's own appointment and gives the service for new times", async () => {
    const { service, calls } = setup([appointment({})]);
    const input = { callerE164: CALLER, callerName: "Hélène", appointmentId: "appt_1" };
    assert.deepEqual(await service.forRescheduling(config, input), {
      serviceId: "svc_1",
      serviceAddress: "45 rue Secrète, Montréal",
      serviceName: "Débouchage",
    });
    assert.deepEqual(await service.cancel(config, input), { status: "canceled" });
    assert.deepEqual(calls.cancel, ["appt_1"]);
  });

  it("does not move or cancel an appointment that is already canceled", async () => {
    const { service, calls } = setup([appointment({ status: "canceled" })]);
    const input = { callerE164: CALLER, callerName: "Hélène", appointmentId: "appt_1" };
    assert.deepEqual(await service.cancel(config, input), { status: "not_found" });
    assert.deepEqual(calls.cancel, []);
  });
});

describe("texts to the caller", () => {
  const base = { callId: "room-123456", callerE164: CALLER, language: "fr" as const };

  it("texts the business's own details once per call, from the business number, with STOP", async () => {
    const t = textPort();
    const { service } = setup([], { texts: t.port });
    assert.deepEqual(await service.text(config, { ...base, kind: "business_info" }), { status: "sent" });
    assert.deepEqual(
      await service.text(config, { ...base, kind: "business_info" }),
      { status: "already_sent" },
      "a repeated tool call never texts twice",
    );
    assert.equal(t.sent.length, 1);
    const [message] = t.sent;
    assert.equal(message!.toE164, CALLER);
    assert.equal(message!.fromE164, "+14385550199");
    assert.match(message!.body, /^Plomberie Nord\nAdresse : 12 rue Principale, Laval\nTél\. : 450 555-0100\nHeures : du lundi au vendredi, de 8 h à 17 h\nRépondez STOP/);
  });

  it("never texts a number that opted out", async () => {
    const t = textPort({ suppressed: true });
    const { service } = setup([], { texts: t.port });
    assert.deepEqual(await service.text(config, { ...base, kind: "business_info" }), { status: "opted_out" });
    assert.equal(t.queued.size, 0);
  });

  it("texts an appointment only to its owner, and never shows its address", async () => {
    const t = textPort();
    const { service } = setup([appointment({})], { texts: t.port });
    assert.deepEqual(
      await service.text(config, { ...base, callerName: "Robert", kind: "appointment", appointmentId: "appt_1" }),
      { status: "not_found" },
    );
    assert.deepEqual(
      await service.text(config, { ...base, callerName: "Hélène", kind: "appointment", appointmentId: "appt_1" }),
      { status: "sent" },
    );
    assert.match(t.sent[0]!.body, /^Plomberie Nord : votre rendez-vous \(Débouchage\) est prévu /);
    assert.doesNotMatch(t.sent[0]!.body, /Secrète/);
  });

  it("says queued only when the cron will retry, and failed when it will not", async () => {
    const retry = textPort({ fail: new SmsDeliveryError("retry", "provider_5xx") });
    assert.deepEqual(
      await setup([], { texts: retry.port }).service.text(config, { ...base, kind: "business_info" }),
      { status: "queued" },
    );
    assert.equal(retry.failed.length, 1);
    const dead = textPort({ fail: new SmsDeliveryError("dead", "invalid_number") });
    assert.deepEqual(
      await setup([], { texts: dead.port }).service.text(config, { ...base, kind: "business_info" }),
      { status: "failed" },
    );
  });

  it("is unavailable without a business SMS number or a caller ID", async () => {
    const t = textPort();
    const { service } = setup([], { texts: t.port });
    const noSms = { ...config, smsFromE164: undefined } as ReceptionistConfig;
    assert.deepEqual(await service.text(noSms, { ...base, kind: "business_info" }), { status: "unavailable" });
    assert.deepEqual(
      await service.text(config, { ...base, callerE164: undefined, kind: "business_info" }),
      { status: "unavailable" },
    );
    assert.equal(t.sent.length, 0);
  });

  it("keeps one stable outbox id per call and kind", () => {
    assert.equal(callerTextId("room-1", "business_info"), callerTextId("room-1", "business_info"));
    assert.notEqual(callerTextId("room-1", "business_info"), callerTextId("room-2", "business_info"));
    assert.notEqual(callerTextId("room-1", "appointment", "a"), callerTextId("room-1", "appointment", "b"));
    assert.match(callerTextId("room-1", "business_info"), /^rctext_[0-9a-f]{24}$/);
  });

  it("writes hours the way each language says them", () => {
    const hours = { start: "08:30", end: "17:00", days: [1, 2, 3, 4, 5, 6] };
    assert.equal(hoursForText(hours, "fr"), "du lundi au samedi, de 8 h 30 à 17 h");
    assert.equal(hoursForText(hours, "en"), "Monday to Saturday, 08:30-17:00");
  });
});
