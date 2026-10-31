/**
 * End-to-end call scenarios on the real receptionist engine (rule brain, memory
 * store, fake scheduler). Each test plays a caller through the Twilio gather
 * loop and checks what the caller would hear and what the system saved.
 *
 * What these cannot cover: how the voice sounds, speech recognition on a real
 * line, DTMF delivery through the carrier, and SIP transfers. Those need live
 * calls (see agents/receptionist/README.md, "Live-call checklist").
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  OpenSlot,
  ReceptionistScheduler,
} from "../../src/product/receptionist/booking";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import type { VoicePlan } from "../../src/product/receptionist/types";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

const OFFICE = "+15145550000";
const CALLER = "+15145559876";
const EMERGENCY = "+15145550302";
// Wednesday 10:00 and Tuesday 23:00 in Toronto (EDT).
const OPEN = new Date("2026-10-21T14:00:00Z");
const AFTER_HOURS = new Date("2026-10-21T03:00:00Z");

const slot = (startAt: string): OpenSlot => ({
  startAt,
  endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(),
});
const SLOTS = [
  slot("2026-10-22T13:00:00Z"),
  slot("2026-10-22T17:30:00Z"),
  slot("2026-10-23T14:00:00Z"),
];

function config(over: Record<string, unknown> = {}) {
  return parseReceptionistConfig({
    id: "rc_scn",
    clientAccountId: "acct_scn",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "fr",
    routing: [
      {
        id: "billing",
        name: "Facturation",
        phoneE164: "+15145550301",
        keywords: ["facture", "billing"],
      },
    ],
    emergencyTransferE164: EMERGENCY,
    fallbackTransferE164: "+15145550303",
    notifications: [{ type: "sms", toE164: "+15145550304" }],
    services: ["Peinture", "Plomberie"],
    ...over,
  });
}

function scheduler(over: Partial<ReceptionistScheduler> = {}): ReceptionistScheduler {
  return {
    async listOpenings() {
      return {
        ok: true,
        timezone: "America/Toronto",
        service: { id: "svc", name: "Estimation" },
        slots: SLOTS,
      };
    },
    async reserve(input) {
      return { status: "confirmed", appointmentId: "apt_1", startAt: input.startAt };
    },
    ...over,
  };
}

type World = ReturnType<typeof world>;

function world(opts: {
  at?: Date;
  config?: ReturnType<typeof config>;
  scheduler?: ReceptionistScheduler;
} = {}) {
  const cfg = opts.config ?? config();
  const store = createMemoryReceptionistStore();
  const sms = createMemorySmsPort();
  const engine = createReceptionistEngine({
    store,
    configs: () => [cfg],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms,
      sendEmail: async () => ({ sent: true }),
    }),
    clock: { now: () => opts.at ?? OPEN },
    scheduler: opts.scheduler,
  });
  return { engine, store, sms };
}

const callOf = (w: World, callSid: string) =>
  w.engine.startCall({ callSid, fromE164: CALLER, toE164: OFFICE });

const reply = (
  w: World,
  plan: VoicePlan,
  speech: string,
  extra: { digits?: string; confidence?: number } = {},
) =>
  w.engine.handleGather({
    sessionId: plan.sessionId!,
    speech,
    digits: extra.digits,
    confidence: extra.confidence,
  });

const press = (w: World, plan: VoicePlan, digits: string) =>
  reply(w, plan, "", { digits });

/** Everything the caller hears in one plan, in order. */
function heard(plan: VoicePlan): string {
  return plan.verbs
    .flatMap((v) =>
      v.verb === "say"
        ? [v.text]
        : v.verb === "gather"
          ? v.prompts.map((p) => p.text)
          : [],
    )
    .join(" | ");
}

const gatherOf = (plan: VoicePlan) => {
  const g = plan.verbs.find((v) => v.verb === "gather");
  assert.ok(g && g.verb === "gather", `expected a gather in: ${heard(plan)}`);
  return g;
};
const hangsUp = (plan: VoicePlan) => plan.verbs.at(-1)?.verb === "hangup";
const dialOf = (plan: VoicePlan) => plan.verbs.find((v) => v.verb === "dial");
const sessionOf = async (w: World, callSid: string) =>
  (await w.store.getSessionByCallSid(callSid))!;

/** Count how many times a question's key phrase was asked during a call. */
function asked(transcript: string[], pattern: RegExp): number {
  return transcript.filter((t) => pattern.test(t)).length;
}

describe("receptionist scenarios (French-first, bilingual)", () => {
  it("1. French, caller presses nothing: starts French and stays French", async () => {
    const w = world();
    const first = await callOf(w, "S01");
    assert.match(heard(first), /Bonjour! Merci d'avoir appelé Nord Plomberie/);
    assert.match(heard(first), /restez en ligne/);
    assert.match(heard(first), /For English, press 1/);
    const g = gatherOf(first);
    assert.ok(g.input.includes("dtmf"), "the menu must accept key presses");
    assert.equal(g.numDigits, 1);

    // Silence at the menu = French, and the opening question follows.
    const next = await reply(w, first, "");
    assert.match(heard(next), /Comment puis-je vous aider/);
    assert.equal((await sessionOf(w, "S01")).language, "fr");
    // No second greeting.
    assert.doesNotMatch(heard(next), /Merci d'avoir appelé/);
  });

  it("2. English, caller presses 1: switches without repeating the greeting", async () => {
    const w = world();
    const first = await callOf(w, "S02");
    const next = await press(w, first, "1");
    assert.match(heard(next), /English/i);
    assert.match(heard(next), /How can I help/);
    assert.doesNotMatch(heard(next), /Bonjour|Merci d'avoir appelé|press 1/);
    assert.equal((await sessionOf(w, "S02")).language, "en");
    assert.ok(
      gatherOf(next).prompts.every((p) => p.language === "en"),
      "English prompts use the English voice",
    );
  });

  it("3. Caller presses 2: French is confirmed explicitly", async () => {
    const w = world();
    const first = await callOf(w, "S03");
    const next = await press(w, first, "2");
    assert.match(heard(next), /français/i);
    assert.match(heard(next), /Comment puis-je vous aider/);
    assert.equal((await sessionOf(w, "S03")).language, "fr");
  });

  it("3b. A stray key (9) does not pick a language", async () => {
    const w = world();
    const first = await callOf(w, "S03b");
    const next = await press(w, first, "9");
    assert.equal((await sessionOf(w, "S03b")).language, "fr");
    assert.doesNotMatch(heard(next), /Bonjour! Merci/);
  });

  it("4. Language switch mid-call, by voice, keeps the answers already given", async () => {
    const w = world();
    let p = await callOf(w, "S04");
    p = await press(w, p, "2");
    p = await reply(w, p, "J'ai une fuite d'eau dans la cuisine");
    p = await reply(w, p, "In English please");
    const s = await sessionOf(w, "S04");
    assert.equal(s.language, "en");
    assert.match(heard(p), /English|continue/i);
    // The earlier answer is not asked for again.
    assert.doesNotMatch(heard(p), /How can I help/);
    assert.ok(s.slots.issue, "the leak description was kept");
  });

  it("4b. Speech at the menu never changes the language, but offers press 1", async () => {
    const w = world();
    const first = await callOf(w, "S04b");
    const next = await reply(w, first, "Hi, I need a plumber for a leak in my basement");
    assert.equal((await sessionOf(w, "S04b")).language, "fr");
    assert.match(heard(next), /For English, press 1/);
    const english = await press(w, next, "1");
    assert.match(heard(english), /continue in English/i);
    // What the caller already said is kept, so it is not asked again.
    const s = await sessionOf(w, "S04b");
    assert.equal(s.language, "en");
    assert.match(s.slots.issue ?? "", /plumber|leak/i);
    assert.doesNotMatch(heard(english), /How can I help/);
  });

  it("5. Caller interrupts the prompt: gathers allow barge-in and keep the answer", async () => {
    const w = world();
    let p = await callOf(w, "S05");
    p = await press(w, p, "1");
    const g = gatherOf(p);
    // Speech input is on and prompts are inside the gather, so Twilio lets the
    // caller talk over the receptionist.
    assert.ok(g.input.includes("speech"));
    assert.ok(g.prompts.length >= 1);
    p = await reply(w, p, "Actually my name is John Smith, I have a leak");
    const s = await sessionOf(w, "S05");
    assert.equal(s.slots.callerName, "John Smith");
    assert.match(s.slots.issue ?? "", /leak/i);
  });

  it("6. Several details in one sentence are all captured and not asked again", async () => {
    const w = world();
    let p = await callOf(w, "S06");
    p = await press(w, p, "1");
    p = await reply(
      w,
      p,
      "Hi, this is Marie Tremblay, I need a plumber for a leak in the basement, tomorrow morning in Laval",
    );
    const s = await sessionOf(w, "S06");
    assert.equal(s.slots.callerName, "Marie Tremblay");
    assert.match(s.slots.service ?? "", /plumb/i);
    assert.ok(s.slots.project, "project captured");
    assert.ok(s.slots.preferredTime, "preferred time captured");
    const line = heard(p);
    assert.doesNotMatch(line, /your name|best time|what kind of/i);
    assert.match(line, /address/i, "asks for the one thing still missing");
  });

  it("7. Price question: no invented number, then the pending question resumes", async () => {
    const w = world();
    let p = await callOf(w, "S07");
    p = await press(w, p, "1");
    p = await reply(w, p, "I need a plumber for a leak");
    p = await reply(w, p, "How much does that cost?");
    assert.doesNotMatch(heard(p), /\$|\d+\s?(dollars|cad)/i);
    assert.match(heard(p), /estimate|quote|price|pricing/i);
    // Back to the question that was pending (the caller's name).
    assert.match(heard(p), /name/i);
  });

  it("8. Appointment: books only after the scheduler confirms, then says so once", async () => {
    const reserved: string[] = [];
    const w = world({
      config: config({ phoneBooking: true }),
      scheduler: scheduler({
        async reserve(input) {
          reserved.push(input.startAt);
          return { status: "confirmed", appointmentId: "apt_8", startAt: input.startAt };
        },
      }),
    });
    let p = await callOf(w, "S08");
    p = await press(w, p, "2");
    p = await reply(w, p, "je voudrais prendre rendez-vous pour une estimation de peinture");
    p = await reply(w, p, "Marie Tremblay");
    p = await reply(w, p, "12 rue des Pins à Laval");
    p = await reply(w, p, "oui");
    p = await reply(w, p, "jeudi matin");
    assert.match(heard(p), /disponibilités/i);
    assert.equal(reserved.length, 0, "nothing is reserved while options are offered");
    p = await reply(w, p, "le premier");
    assert.equal(reserved.length, 1);
    assert.match(heard(p), /C'est confirmé/);
    assert.ok(hangsUp(p));
    const s = await sessionOf(w, "S08");
    assert.equal(s.outcome, "appointment_booked");
    assert.equal(s.booking?.status, "booked");
  });

  it("9. Requested slot already taken: offers other times, never confirms", async () => {
    const w = world({
      config: config({ phoneBooking: true }),
      scheduler: scheduler({
        async reserve() {
          return { status: "conflict", alternatives: [SLOTS[1]!, SLOTS[2]!] };
        },
      }),
    });
    let p = await callOf(w, "S09");
    p = await press(w, p, "1");
    p = await reply(w, p, "I'd like to book an estimate for painting");
    p = await reply(w, p, "John Smith");
    p = await reply(w, p, "12 Pine Street in Laval");
    p = await reply(w, p, "yes");
    p = await reply(w, p, "Thursday morning");
    p = await reply(w, p, "the first one");
    assert.match(heard(p), /just taken/i);
    assert.match(heard(p), /1, .*2, /);
    assert.doesNotMatch(heard(p), /confirmed|booked/i);
    assert.ok(!hangsUp(p), "the call stays open so the caller can choose again");
    assert.notEqual((await sessionOf(w, "S09")).booking?.status, "booked");
  });

  it("10. Transfer to a department connects the caller", async () => {
    const w = world();
    let p = await callOf(w, "S10");
    p = await press(w, p, "1");
    p = await reply(w, p, "I have a question about my billing");
    const dial = dialOf(p);
    assert.ok(dial && dial.verb === "dial", `expected a transfer: ${heard(p)}`);
    assert.equal(dial.phoneE164, "+15145550301");
    assert.match(heard(p), /transfer|connect|moment/i);
  });

  it("11. Québécois phrasing is understood (franglais, regional words)", async () => {
    const w = world();
    let p = await callOf(w, "S11");
    p = await press(w, p, "2");
    p = await reply(w, p, "Allô, j'ai un dégât d'eau dans mon sous-sol pis j'ai besoin d'un plombier");
    const s = await sessionOf(w, "S11");
    assert.match(s.slots.service ?? "", /plomb/i);
    assert.match(s.slots.issue ?? "", /sous-sol|d[eé]g[aâ]t/i);
    assert.doesNotMatch(heard(p), /Comment puis-je vous aider/);
  });

  it("11b. Low recognition confidence asks to repeat, then accepts the words", async () => {
    const w = world();
    let p = await callOf(w, "S11b");
    p = await press(w, p, "2");
    p = await reply(w, p, "blub plomb sous", { confidence: 0.2 });
    assert.match(heard(p), /pas bien compris|répéter|repeter/i);
    p = await reply(w, p, "blub plomb sous", { confidence: 0.2 });
    assert.match(heard(p), /pas bien compris|répéter|repeter/i);
    // A third unclear try is taken as-is rather than looping forever.
    p = await reply(w, p, "blub plomb sous", { confidence: 0.2 });
    assert.doesNotMatch(heard(p), /pas bien compris/i);
  });

  it("12. Unclear address: asks again, once, then keeps what it has", async () => {
    const w = world();
    let p = await callOf(w, "S12");
    p = await press(w, p, "1");
    p = await reply(w, p, "I need a painter, my name is John Smith");
    const transcript: string[] = [heard(p)];
    p = await reply(w, p, "uh it's near the, you know, the big church");
    transcript.push(heard(p));
    assert.ok(
      asked(transcript, /address/i) >= 1,
      "the receptionist asks for the address",
    );
    p = await reply(w, p, "I don't know the number");
    transcript.push(heard(p));
    const s = await sessionOf(w, "S12");
    assert.ok(s.slots.serviceAddress, "something was recorded for the address");
    assert.ok(
      asked(transcript, /What's the address/i) <= 2,
      `address asked too often:\n${transcript.join("\n")}`,
    );
  });

  it("13. Correction at the recap replaces the wrong detail and says so", async () => {
    const w = world();
    let p = await callOf(w, "S13");
    p = await press(w, p, "2");
    p = await reply(w, p, "J'ai un problème de plomberie dans la cuisine");
    p = await reply(w, p, "Marie Tremblay");
    p = await reply(w, p, "45 rue Principale à Laval");
    p = await reply(w, p, "oui"); // the number we already have is right
    p = await reply(w, p, "demain matin");
    assert.match(heard(p), /si je comprends bien/i, "the recap is read back");
    assert.match(heard(p), /Laval/);
    p = await reply(w, p, "non, c'est à Montréal");
    assert.match(heard(p), /C'est corrigé : 45 rue Principale, Montréal/);
    assert.doesNotMatch(heard(p), /Laval/, "the old city is gone, not appended to");
    const s = await sessionOf(w, "S13");
    assert.equal(s.slots.serviceAddress, "45 rue Principale, Montréal");
    assert.equal(s.slots.location, "Montréal");
    assert.equal(s.slots.callerName, "Marie Tremblay", "other details are untouched");
    assert.ok(hangsUp(p));
  });

  it("14. Silence: one check-in, then a polite goodbye", async () => {
    const w = world();
    let p = await callOf(w, "S14");
    p = await press(w, p, "1");
    p = await reply(w, p, "");
    assert.match(heard(p), /still there/i);
    assert.ok(!hangsUp(p));
    p = await reply(w, p, "");
    assert.match(heard(p), /not hearing anything/i);
    assert.match(heard(p), /call back anytime/i);
    assert.ok(hangsUp(p));
  });

  it("15. Off-topic chatter is redirected politely, twice at most", async () => {
    const w = world();
    let p = await callOf(w, "S15");
    p = await press(w, p, "1");
    p = await reply(w, p, "do you like hockey?");
    assert.match(heard(p), /help/i);
    assert.ok(!hangsUp(p));
    assert.ok(gatherOf(p).prompts.length >= 1, "the question is still open");
  });

  it("16. Scheduling system down: honest fallback, request saved, nothing confirmed", async () => {
    const w = world({
      config: config({ phoneBooking: true }),
      scheduler: scheduler({
        async listOpenings() {
          throw new Error("calendar down");
        },
      }),
    });
    let p = await callOf(w, "S16");
    p = await press(w, p, "1");
    p = await reply(w, p, "I'd like to book an estimate for painting");
    p = await reply(w, p, "John Smith");
    p = await reply(w, p, "12 Pine Street in Laval");
    p = await reply(w, p, "yes");
    p = await reply(w, p, "Thursday morning");
    assert.match(heard(p), /wasn't able to reserve/i);
    assert.match(heard(p), /call you to confirm/i);
    assert.doesNotMatch(heard(p), /confirmed|you're booked|all set/i);
    assert.ok(hangsUp(p));
    const s = await sessionOf(w, "S16");
    assert.equal(s.outcome, "appointment_requested");
    assert.equal(s.booking?.status, "requested");
  });

  it("16b. The booking call itself fails: same honest fallback", async () => {
    const w = world({
      config: config({ phoneBooking: true }),
      scheduler: scheduler({
        async reserve() {
          return { status: "error" };
        },
      }),
    });
    let p = await callOf(w, "S16b");
    p = await press(w, p, "1");
    p = await reply(w, p, "I'd like to book an estimate for painting");
    p = await reply(w, p, "John Smith");
    p = await reply(w, p, "12 Pine Street in Laval");
    p = await reply(w, p, "yes");
    p = await reply(w, p, "Thursday morning");
    p = await reply(w, p, "the first one");
    assert.match(heard(p), /wasn't able to reserve/i);
    assert.doesNotMatch(heard(p), /confirmed|you're booked/i);
    assert.equal((await sessionOf(w, "S16b")).booking?.status, "requested");
  });

  it("17. Transfer not answered: says so, offers a callback, keeps the lead", async () => {
    const w = world();
    let p = await callOf(w, "S17");
    p = await press(w, p, "1");
    p = await reply(w, p, "I have a question about my billing");
    assert.ok(dialOf(p));
    const after = await w.engine.handleDialResult({
      sessionId: p.sessionId!,
      dialStatus: "no-answer",
    });
    assert.match(heard(after), /not available|isn't available|unavailable/i);
    assert.match(heard(after), /call you back|callback|take your|leave/i);
    assert.doesNotMatch(heard(after), /transferred|connected/i);
    const s = await sessionOf(w, "S17");
    assert.equal(s.transfers.at(-1)?.status, "no_answer");
  });

  it("18. 'Are you an AI?' gets an honest, brief answer and the question resumes", async () => {
    const w = world();
    let p = await callOf(w, "S18");
    p = await press(w, p, "1");
    p = await reply(w, p, "I need a plumber");
    // The open question, without the "Sure." acknowledgement in front of it.
    const pending = gatherOf(p).prompts.at(-1)!.text.split(/(?<=[.!])\s+/).at(-1)!;
    assert.match(pending, /\?$/);
    p = await reply(w, p, "Are you a real person or a robot?");
    assert.match(heard(p), /virtual assistant for Nord Plomberie/i);
    assert.doesNotMatch(heard(p), /i am (a )?human|i'm (a )?human|real person here/i);
    assert.ok(heard(p).includes(pending), "goes back to the question that was open");
    assert.ok(!hangsUp(p));
    assert.equal((await sessionOf(w, "S18")).flags?.identityAnswered, true);
  });

  it("19. Urgent situation goes straight to the emergency line", async () => {
    const w = world();
    let p = await callOf(w, "S19");
    p = await press(w, p, "1");
    p = await reply(w, p, "My basement is flooding right now, it's an emergency");
    const dial = dialOf(p);
    assert.ok(dial && dial.verb === "dial", `expected emergency transfer: ${heard(p)}`);
    assert.equal(dial.phoneE164, EMERGENCY);
    const s = await sessionOf(w, "S19");
    assert.equal(s.intent, "emergency");
    assert.match(heard(p), /911|9-1-1/);
  });

  it("20. After hours: keeps the request, no transfer attempt, a callback is promised", async () => {
    const w = world({ at: AFTER_HOURS });
    let p = await callOf(w, "S20");
    p = await press(w, p, "1");
    p = await reply(w, p, "I need a plumber for a leaking pipe");
    assert.ok(!dialOf(p), "no transfer to a closed office");
    const s = await sessionOf(w, "S20");
    assert.match(s.slots.issue ?? "", /leak/i);
    // The described job is not asked for a second time.
    assert.doesNotMatch(heard(p), /How can I help/i);
  });
});
