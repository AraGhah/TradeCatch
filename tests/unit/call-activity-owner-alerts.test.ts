/**
 * KAN-15 · a call the receptionist never handled still reaches its owner.
 *
 * A call the receptionist declined (switched off, outside its hours) or that is
 * known only from the provider's status callback is saved, and the OWNER is
 * told: an SMS and an email with the caller's number as "(514) 555-1234".
 * The caller is never texted, a retried webhook never alerts twice, and a call
 * that may well have been answered is listed without an alert.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessNotifyInput } from "../../src/lib/business-notifications";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";

const LINE = "+14385597001";
const CALLER = "+15145559876";
const OWNER_SMS = "+15145550100";
const OWNER_EMAIL = "owner@example.test";
const T0 = new Date("2026-11-17T14:00:00.000Z");

function config(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_a",
    clientAccountId: "client_a",
    phoneNumberE164: LINE,
    businessName: "Plomberie A",
    languages: ["en", "fr"],
    defaultLanguage: "en",
    timezone: "America/Toronto",
    notifications: [
      { type: "sms", toE164: OWNER_SMS },
      { type: "email", to: OWNER_EMAIL },
    ],
    ...over,
  });
}

function setup(
  opts: {
    config?: ReceptionistConfig;
    active?: boolean;
    smsFails?: boolean;
  } = {},
) {
  const cfg = opts.config ?? config();
  const store = createMemoryReceptionistStore();
  const memorySms = createMemorySmsPort();
  const emails: BusinessNotifyInput[] = [];
  const sms = opts.smsFails
    ? {
        ...memorySms,
        async send(): Promise<never> {
          throw Object.assign(new Error("provider down"), { code: 21610 });
        },
      }
    : memorySms;
  const engine = createReceptionistEngine({
    store,
    configs: () => [cfg],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms,
      sendEmail: async (message) => {
        emails.push(message);
        return { sent: true };
      },
    }),
    clock: { now: () => new Date(T0) },
    confirmActive: async () => opts.active !== false,
  });
  return { cfg, store, engine, memorySms, emails };
}

type Harness = ReturnType<typeof setup>;
const only = async (h: Harness) => {
  const rows = await h.store.listSessions({ clientAccountId: "client_a" });
  assert.equal(rows.length, 1, "exactly one record for the call");
  return rows[0]!;
};

describe("a declined call alerts its owner", () => {
  it("texts and emails the owner, never the caller, with the number readable", async () => {
    const h = setup({ active: false });
    await h.engine.startCall({ callSid: "CAdec01", fromE164: "(514) 555-9876", toE164: LINE });

    const call = await only(h);
    assert.equal(call.fromE164, CALLER, "stored as E.164");
    assert.equal(call.activity?.declinedCode, "RECEPTIONIST_DEACTIVATED");

    // One SMS, to the owner, internal; nothing goes to the caller.
    assert.equal(h.memorySms.sent.length, 1);
    const text = h.memorySms.sent[0]!;
    assert.equal(text.toE164, OWNER_SMS);
    assert.equal(text.internal, true);
    assert.match(text.body, /Phone: \(514\) 555-9876/);
    assert.match(text.body, /Status: Not taken by the receptionist — call back/);
    assert.doesNotMatch(text.body, /\+1514|\+1 514/);
    assert.ok(h.memorySms.sent.every((m) => m.toE164 !== CALLER), "the caller is never texted");

    // One email to the owner, same wording.
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0]!.toEmail, OWNER_EMAIL);
    const info = h.emails[0]!.sections!.find((s) => s.heading === "Call information")!;
    const value = (label: string) => info.lines.find((l) => l.label === label)?.value;
    assert.equal(value("Caller number"), "(514) 555-9876");
    assert.equal(value("Call status"), "Not taken by the receptionist — call back");

    // The deliveries and the summary are recorded on the call (the retry job reads them).
    assert.ok(call.summary, "summary saved");
    assert.match(call.summary!.nextStep, /Call back \(514\) 555-9876/);
    assert.equal(call.notifications.filter((n) => n.ok).length, 2);
    assert.equal(call.routing?.quiet, true, "still no text-back, no CRM lead");
  });

  it("alerts once however many times the provider retries the call", async () => {
    const h = setup({ active: false });
    for (let i = 0; i < 3; i += 1)
      await h.engine.startCall({ callSid: "CAdec02", fromE164: CALLER, toE164: LINE });
    await only(h);
    assert.equal(h.memorySms.sent.length, 1);
    assert.equal(h.emails.length, 1);
  });

  it("sends the alert after the caller is answered when the route defers it", async () => {
    const h = setup({ active: false });
    const later: (() => Promise<void>)[] = [];
    await h.engine.startCall({
      callSid: "CAdec03",
      fromE164: CALLER,
      toE164: LINE,
      defer: (task) => void later.push(task),
    });
    await only(h);
    assert.equal(h.memorySms.sent.length, 0, "nothing is sent while the caller waits");
    await Promise.all(later.map((task) => task()));
    assert.equal(h.memorySms.sent.length, 1);
    assert.equal(h.emails.length, 1);
  });

  it("is written in the owner's language", async () => {
    const h = setup({ active: false, config: config({ defaultLanguage: "fr" }) });
    await h.engine.startCall({ callSid: "CAdec04", fromE164: CALLER, toE164: LINE });
    const body = h.memorySms.sent[0]!.body;
    assert.match(body, /Téléphone: \(514\) 555-9876/);
    assert.match(body, /Statut: Non pris par la réceptionniste — rappeler/);
    assert.match((await only(h)).summary!.nextStep, /Rappeler le \(514\) 555-9876/);
  });

  it("does not print a withheld caller as a number", async () => {
    const h = setup({ active: false });
    await h.engine.startCall({ callSid: "CAdec05", fromE164: "anonymous", toE164: LINE });
    const body = h.memorySms.sent[0]!.body;
    assert.doesNotMatch(body, /Phone:/);
    assert.doesNotMatch(body, /anonymous/i);
    const call = await only(h);
    assert.match(call.summary!.headline, /unknown number/);
    assert.match(call.summary!.nextStep, /the caller \(number withheld\)/);
  });

  it("respects the owner's choice of emergencies only, and a practice call never alerts", async () => {
    const quiet = setup({ active: false, config: config({ emergencyOnlyAlerts: true }) });
    await quiet.engine.startCall({ callSid: "CAdec06", fromE164: CALLER, toE164: LINE });
    await only(quiet);
    assert.equal(quiet.memorySms.sent.length, 0);
    assert.equal(quiet.emails.length, 0);

    const practice = setup({ active: false });
    await practice.engine.startCall({ callSid: "sim_decline", fromE164: CALLER, toE164: LINE });
    assert.equal(practice.memorySms.sent.length, 0);
  });

  it("keeps the call and records the failure when the alert cannot be sent", async () => {
    const h = setup({ active: false, smsFails: true });
    await h.engine.startCall({ callSid: "CAdec07", fromE164: CALLER, toE164: LINE });
    const call = await only(h);
    assert.equal(call.activity?.declinedCode, "RECEPTIONIST_DEACTIVATED", "the call is still saved");
    const sms = call.notifications.find((n) => n.channel === "sms");
    assert.equal(sms?.ok, false, "the failed text is recorded, not hidden");
    assert.doesNotMatch(JSON.stringify(call.notifications), /5145559876|5145550100/, "no full numbers in the log");
    assert.equal(h.emails.length, 1, "the email channel is independent");
  });
});

describe("a call known only from its status callback alerts its owner when nobody took it", () => {
  const status = (h: Harness, callSid: string, callStatus: string, durationSeconds?: number) =>
    h.engine.handleCallStatus({
      callSid,
      callStatus,
      durationSeconds,
      fromE164: CALLER,
      toE164: LINE,
      createIfMissing: true,
    });

  it("alerts once for a no-answer call, even when the callback is delivered again", async () => {
    const h = setup();
    await status(h, "CAst01", "no-answer", 0);
    await status(h, "CAst01", "no-answer", 0);
    await status(h, "CAst01", "no-answer", 0);

    const call = await only(h);
    assert.equal(call.activity?.origin, "status_callback");
    assert.equal(h.memorySms.sent.length, 1);
    assert.equal(h.emails.length, 1);
    assert.match(h.memorySms.sent[0]!.body, /Phone: \(514\) 555-9876/);
    assert.match(h.memorySms.sent[0]!.body, /Status: Missed call — call back/);
    assert.ok(h.memorySms.sent.every((m) => m.toE164 !== CALLER));
  });

  it("says a failed call failed", async () => {
    const h = setup();
    await status(h, "CAst02", "failed");
    assert.match(h.memorySms.sent[0]!.body, /Status: Call failed — call back/);
  });

  it("lists a completed call without alerting: it may well have been answered", async () => {
    const h = setup();
    await status(h, "CAst03", "completed", 420);
    const call = await only(h);
    assert.equal(call.durationSeconds, 420);
    assert.equal(h.memorySms.sent.length, 0);
    assert.equal(h.emails.length, 0);
  });

  it("does not alert for a call the receptionist already has", async () => {
    const h = setup();
    await h.engine.startCall({ callSid: "CAst04", fromE164: CALLER, toE164: LINE });
    const before = h.memorySms.sent.length;
    await status(h, "CAst04", "no-answer", 0);
    // The receptionist's own finalize owns this call's summary and alerts; the
    // status callback adds no second, "unhandled" alert on top of it.
    const call = await only(h);
    assert.notEqual(call.activity?.origin, "status_callback");
    const unhandled = h.memorySms.sent.slice(before).filter((m) => /Missed call — call back/.test(m.body));
    assert.equal(unhandled.length, 0);
  });
});
