import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimsBooking,
  localDayWindow,
  matchOffered,
  parseTimePreference,
  pickOffers,
  spokenSlotLabel,
  type ReceptionistScheduler,
} from "../../src/product/receptionist/booking";
import { createLlmBrain } from "../../src/product/receptionist/brain-llm";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import type { LlmClient } from "../../src/product/receptionist/llm";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import {
  chooseService,
  createPhoneScheduler,
} from "../../src/product/receptionist/phone-booking";
import {
  appointmentSettingsSchema,
  buildProfileConfig,
  defaultProfileSettings,
  profileSettingsSchema,
} from "../../src/product/receptionist/profile";
import { buildCallSummary } from "../../src/product/receptionist/summary";
import {
  createMemoryReceptionistStore,
  redactSession,
} from "../../src/product/receptionist/store";
import type {
  OfferedSlot,
  ReceptionistConfig,
  VoicePlan,
} from "../../src/product/receptionist/types";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  createSchedulingService,
  createSimulatedCalendar,
  type CalendarPort,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import type { ServiceType } from "../../src/product/scheduling/types";

const OFFICE = "+15145550000";
const CALLER = "+15145559876";
const ORG = "org-a";
const TZ = "America/Toronto";

// Wednesday 2026-10-21, 10:00 in Toronto (EDT, UTC-4).
const NOW = new Date("2026-10-21T14:00:00Z");

const slot = (startAt: string, minutes = 60) => ({
  startAt,
  endAt: new Date(Date.parse(startAt) + minutes * 60_000).toISOString(),
});

describe("phone booking — spoken labels", () => {
  it("renders a time the caller can follow, in both languages", () => {
    assert.equal(
      spokenSlotLabel("2026-10-22T13:30:00Z", TZ, "en"),
      "Thursday, October 22 at 9:30 AM",
    );
    assert.equal(
      spokenSlotLabel("2026-10-22T18:00:00Z", TZ, "en"),
      "Thursday, October 22 at 2 PM",
    );
    assert.equal(
      spokenSlotLabel("2026-10-22T13:30:00Z", TZ, "fr"),
      "jeudi 22 octobre à 9 h 30",
    );
    assert.equal(
      spokenSlotLabel("2026-10-22T18:00:00Z", TZ, "fr"),
      "jeudi 22 octobre à 14 h",
    );
    assert.equal(
      spokenSlotLabel("2026-11-01T15:00:00Z", TZ, "fr"),
      "dimanche 1er novembre à 10 h",
    );
  });

  it("finds a local calendar day across a daylight-saving change", () => {
    const spring = localDayWindow("2026-03-08", TZ);
    assert.equal(
      (spring.until.getTime() - spring.from.getTime()) / 3_600_000,
      23,
    );
    const autumn = localDayWindow("2026-11-01", TZ);
    assert.equal(
      (autumn.until.getTime() - autumn.from.getTime()) / 3_600_000,
      25,
    );
    const normal = localDayWindow("2026-10-22", TZ);
    assert.equal(normal.from.toISOString(), "2026-10-22T04:00:00.000Z");
  });
});

describe("phone booking — what the caller asks for", () => {
  const read = (text: string) => parseTimePreference(text, NOW, TZ);

  it("understands days, parts of the day and clock times in French and English", () => {
    assert.deepEqual(read("tomorrow morning"), {
      dateKey: "2026-10-22",
      part: "morning",
    });
    assert.deepEqual(read("demain après-midi"), {
      dateKey: "2026-10-22",
      part: "afternoon",
    });
    assert.deepEqual(read("Friday at 2"), {
      dateKey: "2026-10-23",
      minutes: 14 * 60,
    });
    assert.deepEqual(read("lundi matin vers 10 heures"), {
      dateKey: "2026-10-26",
      part: "morning",
      minutes: 10 * 60,
    });
    assert.deepEqual(read("Thursday 2:30 pm"), {
      dateKey: "2026-10-22",
      minutes: 14 * 60 + 30,
    });
    assert.deepEqual(read("à 14h30"), { minutes: 14 * 60 + 30 });
    assert.deepEqual(read("après-demain"), { dateKey: "2026-10-23" });
    assert.deepEqual(read("whenever you can"), {});
    assert.deepEqual(read("in 2 hours"), {}, "a duration is not a clock time");
  });

  it("does not read a street number or a date as a time", () => {
    assert.deepEqual(read("le 21 octobre"), {});
    assert.deepEqual(read("around the 5th"), {});
  });
});

describe("phone booking — choosing what to offer", () => {
  const day = (hh: string, mm = "00", d = "22") =>
    `2026-10-${d}T${hh}:${mm}:00.000Z`;
  // Thursday 08:00..11:30 Toronto, every 30 minutes.
  const morning = Array.from({ length: 8 }, (_, i) =>
    slot(new Date(Date.parse(day("12")) + i * 30 * 60_000).toISOString()),
  );
  const nextDay = slot(day("12", "00", "23"));

  it("spreads three offers instead of reading three neighbours", () => {
    const { picks, exact } = pickOffers([...morning, nextDay], {}, TZ);
    assert.equal(exact, true);
    assert.deepEqual(
      picks.map((p) => p.startAt),
      [day("12"), day("13", "30"), day("15")],
    );
  });

  it("stays on the day and part of day the caller asked for", () => {
    const afternoon = slot(day("19"));
    const { picks, exact } = pickOffers(
      [...morning, afternoon, nextDay],
      { dateKey: "2026-10-22", part: "afternoon" },
      TZ,
    );
    assert.equal(exact, true);
    assert.deepEqual(picks, [afternoon]);
  });

  it("offers the openings closest to a requested clock time", () => {
    const { picks } = pickOffers(morning, { minutes: 10 * 60 }, TZ);
    assert.deepEqual(
      picks.map((p) => p.startAt),
      [day("13", "30"), day("14"), day("14", "30")],
    );
  });

  it("says so when nothing matches and reads the next openings", () => {
    const { picks, exact } = pickOffers(
      [...morning, nextDay],
      { dateKey: "2026-10-24" },
      TZ,
    );
    assert.equal(exact, false);
    assert.ok(picks.length > 0);
  });

  it("drops duplicate start times when several technicians are free", () => {
    const { picks } = pickOffers(
      [morning[0]!, morning[0]!, morning[0]!],
      {},
      TZ,
    );
    assert.equal(picks.length, 1);
  });
});

describe("phone booking — what the caller answers", () => {
  const offered: OfferedSlot[] = [
    { ...slot("2026-10-22T12:00:00Z"), label: "Thursday, October 22 at 8 AM" },
    { ...slot("2026-10-22T18:00:00Z"), label: "Thursday, October 22 at 2 PM" },
    { ...slot("2026-10-23T14:00:00Z"), label: "Friday, October 23 at 10 AM" },
  ];
  const answer = (text: string, digits?: string, list = offered) =>
    matchOffered(text, digits, list, TZ);

  it("accepts a key press, an ordinal, a number or a time", () => {
    assert.deepEqual(answer("", "2"), { kind: "pick", index: 1 });
    assert.deepEqual(answer("the second one"), { kind: "pick", index: 1 });
    assert.deepEqual(answer("le premier s'il vous plaît"), {
      kind: "pick",
      index: 0,
    });
    assert.deepEqual(answer("deuxième"), { kind: "pick", index: 1 });
    assert.deepEqual(answer("the last"), { kind: "pick", index: 2 });
    assert.deepEqual(answer("number three"), { kind: "pick", index: 2 });
    assert.deepEqual(answer("2"), { kind: "pick", index: 1 });
    assert.deepEqual(answer("the 2 PM one"), { kind: "pick", index: 1 });
    assert.deepEqual(answer("Friday works"), { kind: "pick", index: 2 });
    assert.deepEqual(answer("à 8 heures"), { kind: "pick", index: 0 });
  });

  it("does not guess when the answer fits more than one time or none", () => {
    assert.deepEqual(
      answer("Thursday"),
      { kind: "unclear" },
      "two Thursdays offered",
    );
    assert.deepEqual(answer("mmm I don't know"), { kind: "unclear" });
    assert.deepEqual(answer(""), { kind: "unclear" });
    assert.deepEqual(
      answer("", "9"),
      { kind: "unclear" },
      "key beyond the list",
    );
    assert.deepEqual(
      answer("yes"),
      { kind: "unclear" },
      "yes to a list is not a choice",
    );
  });

  it("takes yes for a single offer and recognises a refusal", () => {
    assert.deepEqual(answer("yes that works", undefined, [offered[0]!]), {
      kind: "pick",
      index: 0,
    });
    assert.deepEqual(answer("oui"), { kind: "unclear" });
    assert.deepEqual(answer("none of those"), { kind: "decline" });
    assert.deepEqual(answer("non, aucune"), { kind: "decline" });
    assert.deepEqual(answer("something later please"), { kind: "decline" });
  });
});

describe("phone booking — never let a model confirm a time", () => {
  it("flags a booking claim in either language and leaves honest wording alone", () => {
    for (const claim of [
      "Great, you're all set for Tuesday at 10!",
      "Your appointment is confirmed for Friday.",
      "I've booked you in for 2 PM.",
      "Parfait, votre rendez-vous est confirmé pour mardi.",
      "J'ai réservé jeudi à 10 h pour vous.",
      "C'est confirmé!",
    ]) {
      assert.equal(claimsBooking(claim), true, claim);
    }
    for (const honest of [
      "I've noted your request and the team will call you to confirm.",
      "Thank you Marie. Someone will confirm your appointment shortly.",
      "J'ai bien noté votre demande, l'équipe vous rappellera pour confirmer.",
      "When would be the best time for you?",
    ]) {
      assert.equal(claimsBooking(honest), false, honest);
    }
  });

  it("overrules an LLM reply that claims a booking", async () => {
    const llm: LlmClient = {
      provider: "openai",
      model: "fake",
      async generateJson() {
        return {
          reply: "You're all set for Tuesday at 10 AM!",
          action: "end_call",
          intent: "appointment",
        };
      },
      async generateText() {
        return "";
      },
    };
    const config = makeConfig({ languages: ["en"], defaultLanguage: "en" });
    const decision = await createLlmBrain(llm).decide({
      config,
      utterance: "I want an appointment",
      session: {
        id: "s",
        callSid: "c",
        configId: config.id,
        clientAccountId: config.clientAccountId,
        fromE164: CALLER,
        toE164: OFFICE,
        language: "en",
        status: "in_progress",
        step: "reason",
        afterHours: false,
        slots: {},
        turns: [],
        silenceCount: 0,
        callerTurnCount: 1,
        transfers: [],
        notifications: [],
        startedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        version: 1,
      },
    });
    assert.equal(decision.brain, "rules", "the rule brain answered instead");
    assert.equal(claimsBooking(decision.reply), false);
  });
});

describe("phone booking — which service a call is for", () => {
  const service = (
    name: string,
    bookingMode: ServiceType["bookingMode"],
    over: Partial<ServiceType> = {},
  ): ServiceType => ({
    id: `svc_${name}`,
    organizationId: ORG,
    name,
    durationMinutes: 60,
    bookingMode,
    eligibleTechnicianIds: [],
    active: true,
    ...over,
  });
  const catalog = [
    service("Drain inspection", "automatic"),
    service("Plumbing consultation", "consultation"),
    service("Water heater repair", "automatic"),
    service("Emergency plumbing", "escalate"),
    service("Major installation", "manual_approval"),
  ];

  it("books a service whose name the caller spoke", () => {
    const choice = chooseService(catalog, "my water heater needs a repair");
    assert.equal(
      choice.kind === "service" && choice.service.name,
      "Water heater repair",
    );
    const drain = chooseService(
      catalog,
      "I have a clogged drain, I need an inspection",
    );
    assert.equal(
      drain.kind === "service" && drain.service.name,
      "Drain inspection",
    );
  });

  it("never books an approval or emergency service on its own", () => {
    assert.equal(
      chooseService(catalog, "there is an emergency, water everywhere").kind,
      "needs_review",
    );
    assert.equal(
      chooseService(catalog, "I want a major installation").kind,
      "needs_review",
    );
    assert.equal(
      chooseService(catalog, "I'd like to install a new boiler").kind,
      "needs_review",
    );
  });

  it("falls back to a plain visit when the words do not name a service", () => {
    assert.equal(
      chooseService(catalog, "my kitchen faucet drips").kind,
      "generic",
    );
    assert.equal(
      chooseService(catalog, "plumbing problem").kind,
      "generic",
      "a word shared by two services says nothing",
    );
    assert.equal(chooseService(catalog, undefined).kind, "generic");
    assert.equal(
      chooseService(
        [service("Water heater repair", "automatic", { active: false })],
        "water heater repair",
      ).kind,
      "generic",
      "an inactive service is not offered",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Whole calls against the real scheduling service                            */
/* -------------------------------------------------------------------------- */

function makeConfig(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_test",
    clientAccountId: "client_test",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["en"],
    defaultLanguage: "en",
    emergencyTransferE164: "+15145550302",
    fallbackTransferE164: "+15145550303",
    notifications: [{ type: "sms", toE164: "+15145550304" }],
    phoneBooking: true,
    ...over,
  });
}

function setup(
  opts: {
    config?: ReceptionistConfig;
    calendar?: CalendarPort;
    scheduler?: (
      real: ReceptionistScheduler,
    ) => ReceptionistScheduler | undefined;
    withScheduler?: boolean;
  } = {},
) {
  const config = opts.config ?? makeConfig();
  const schedulingStore = createMemorySchedulingStore();
  const notices: {
    appointmentId: string;
    phoneE164: string;
    startAt: string;
  }[] = [];
  const notified: string[] = [];
  const scheduling = createSchedulingService({
    store: schedulingStore,
    now: () => NOW,
    calendar: async () => opts.calendar ?? createSimulatedCalendar(),
    scheduleNotices: async (input) => {
      notices.push({
        appointmentId: input.appointmentId,
        phoneE164: input.phoneE164,
        startAt: input.startAt,
      });
    },
    notify: async (input) => {
      notified.push(input.reason);
    },
  });
  const real = createPhoneScheduler({
    scheduling: async () => scheduling,
    findOrganizationId: async () => ORG,
  });
  const scheduler = opts.scheduler ? opts.scheduler(real) : real;
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms: createMemorySmsPort(),
      sendEmail: async () => ({ sent: true }),
    }),
    clock: { now: () => NOW },
    scheduler: opts.withScheduler === false ? undefined : scheduler,
  });
  return {
    engine,
    store,
    scheduling,
    schedulingStore,
    notices,
    notified,
    config,
  };
}

type Ctx = ReturnType<typeof setup>;

function texts(plan: VoicePlan): string {
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

async function say(ctx: Ctx, plan: VoicePlan, speech: string, digits?: string) {
  assert.ok(plan.sessionId, "plan has a session");
  return ctx.engine.handleGather({
    sessionId: plan.sessionId!,
    speech,
    digits,
  });
}

/** A caller who wants a water-heater appointment, up to and including their preferred time. */
async function callToOffer(
  ctx: Ctx,
  callSid: string,
  wish = "tomorrow morning",
  from = CALLER,
) {
  let plan = await ctx.engine.startCall({
    callSid,
    fromE164: from,
    toE164: OFFICE,
  });
  plan = await say(
    ctx,
    plan,
    "I'd like to book an appointment for my water heater",
  );
  plan = await say(ctx, plan, "My name is Marie Tremblay");
  plan = await say(ctx, plan, "123 Main Street");
  plan = await say(ctx, plan, "yes");
  assert.match(texts(plan), /best time/i, "asks for the preferred time first");
  return say(ctx, plan, wish);
}

async function confirmed(ctx: Ctx) {
  return (await ctx.scheduling.list(ORG)).filter(
    (a) => a.status === "confirmed",
  );
}

describe("phone booking — a call that books", () => {
  it("preserves emergency routing when an emergency is reported during slot selection", async () => {
    const ctx = setup();
    const offer = await callToOffer(ctx, "CA-emergency-at-offer");
    const plan = await say(ctx, offer, "There is a gas leak and I smell gas");
    assert.equal((await confirmed(ctx)).length, 0);
    const session = await ctx.store.getSession(plan.sessionId!);
    assert.equal(session?.intent, "emergency");
    assert.ok(plan.verbs.some((v) => v.verb === "dial"));
  });
  it("reads real openings, reserves the pick and only then says it is booked", async () => {
    const ctx = setup();
    let plan = await callToOffer(ctx, "CA1");

    assert.match(
      texts(plan),
      /Here are the openings I have: 1, Thursday, October 22 at 8 AM; 2, Thursday, October 22 at 9:30 AM; 3, Thursday, October 22 at 11 AM\./,
    );
    assert.doesNotMatch(
      texts(plan),
      /booked|confirmed/i,
      "nothing is claimed while offering",
    );
    assert.equal((await confirmed(ctx)).length, 0, "offering reserves nothing");
    const offering = await ctx.store.getSession(plan.sessionId!);
    assert.equal(offering?.step, "offer_slot");
    assert.equal(offering?.booking?.serviceName, "Water heater repair");
    const gather = plan.verbs.find((v) => v.verb === "gather");
    assert.ok(
      gather && gather.verb === "gather" && gather.input.includes("dtmf"),
    );

    plan = await say(ctx, plan, "the second one");
    assert.match(
      texts(plan),
      /You're booked, Marie Tremblay: your appointment is Thursday, October 22 at 9:30 AM\./,
    );
    assert.deepEqual(plan.verbs.at(-1), { verb: "hangup" });

    const [appointment] = await confirmed(ctx);
    assert.equal(appointment?.startAt, "2026-10-22T13:30:00.000Z");
    assert.equal(
      appointment?.endAt,
      "2026-10-22T15:00:00.000Z",
      "uses the service's 90 minutes",
    );
    assert.equal(appointment?.customerName, "Marie Tremblay");
    assert.equal(appointment?.customerPhoneE164, CALLER);
    assert.equal(appointment?.serviceAddress, "123 Main Street");
    assert.equal(appointment?.serviceName, "Water heater repair");
    assert.equal(appointment?.bookingSource, "ai_receptionist");
    assert.equal(appointment?.status, "confirmed");
    assert.equal(
      ctx.notices.length,
      1,
      "the confirmation and reminder notices are scheduled",
    );
    assert.equal(ctx.notices[0]?.phoneE164, CALLER);
    assert.ok(
      ctx.notified.includes("New appointment confirmed"),
      "the owner is told",
    );

    const done = await ctx.store.getSession(plan.sessionId!);
    assert.equal(done?.outcome, "appointment_booked");
    assert.equal(done?.booking?.status, "booked");
    assert.equal(done?.booking?.appointmentId, appointment?.id);

    const finished = await ctx.engine.handleCallStatus({
      callSid: "CA1",
      callStatus: "completed",
      durationSeconds: 90,
    });
    const summary = finished.session?.summary;
    assert.equal(summary?.outcome, "appointment_booked");
    assert.equal(summary?.appointment?.status, "booked");
    assert.equal(
      summary?.appointment?.label,
      "Thursday, October 22 at 9:30 AM",
    );
    assert.match(
      summary?.headline ?? "",
      /^Appointment — Marie Tremblay \(Appointment booked\)$/,
    );
    assert.match(
      summary?.nextStep ?? "",
      /Appointment confirmed: Thursday, October 22 at 9:30 AM\. No callback needed\./,
    );
  });

  it("books by key press and in French", async () => {
    const ctx = setup({
      config: makeConfig({ languages: ["fr"], defaultLanguage: "fr" }),
    });
    let plan = await ctx.engine.startCall({
      callSid: "CA2",
      fromE164: CALLER,
      toE164: OFFICE,
    });
    plan = await say(
      ctx,
      plan,
      "Je voudrais prendre un rendez-vous pour mon chauffe-eau",
    );
    plan = await say(ctx, plan, "Je m'appelle Julie Gagnon");
    plan = await say(ctx, plan, "45 rue des Érables");
    plan = await say(ctx, plan, "oui");
    plan = await say(ctx, plan, "jeudi après-midi");
    assert.match(
      texts(plan),
      /Voici les disponibilités : 1, jeudi 22 octobre à 12 h/,
    );
    plan = await say(ctx, plan, "", "2");
    assert.match(
      texts(plan),
      /C'est confirmé, Julie Gagnon : votre rendez-vous est le jeudi 22 octobre à 13 h 30\./,
    );
    const [appointment] = await confirmed(ctx);
    assert.equal(appointment?.startAt, "2026-10-22T17:30:00.000Z");
  });

  it("offers the next openings when the wished-for day has none", async () => {
    const ctx = setup();
    const plan = await callToOffer(ctx, "CA3", "Sunday");
    // Two hours' notice from 10:00 makes 12:00 the earliest opening.
    assert.match(
      texts(plan),
      /I don't have anything at that time\. The next openings are: 1, Wednesday, October 21 at 12 PM; 2, Wednesday, October 21 at 1:30 PM; 3, Wednesday, October 21 at 3 PM\./,
    );
  });

  it("closes an appointment call that the brain was about to end with real openings", async () => {
    const ctx = setup({ config: makeConfig({ collectPreferredTime: false }) });
    let plan = await ctx.engine.startCall({
      callSid: "CA4",
      fromE164: CALLER,
      toE164: OFFICE,
    });
    plan = await say(
      ctx,
      plan,
      "I'd like to book an appointment for my water heater",
    );
    plan = await say(ctx, plan, "Marie Tremblay");
    plan = await say(ctx, plan, "123 Main Street");
    plan = await say(ctx, plan, "yes");
    assert.match(texts(plan), /Here are the openings I have/);
    plan = await say(ctx, plan, "3");
    assert.match(texts(plan), /You're booked/);
    assert.equal((await confirmed(ctx)).length, 1);
  });
});

describe("phone booking — conflict prevention", () => {
  it("offers another time when one was taken during the call, and never double-books", async () => {
    const ctx = setup();
    const first = await callToOffer(ctx, "CB1");
    const second = await callToOffer(
      ctx,
      "CB2",
      "tomorrow morning",
      "+15145558888",
    );
    assert.equal(
      texts(first).split("|")[0],
      texts(second).split("|")[0],
      "same openings were read to both",
    );

    const booked = await say(ctx, first, "1");
    assert.match(texts(booked), /You're booked/);

    const taken = await say(ctx, second, "1");
    assert.match(
      texts(taken),
      /That time was just taken\. I have these instead: 1, /,
    );
    assert.doesNotMatch(
      texts(taken),
      /Thursday, October 22 at 8 AM/,
      "the taken time is not offered again",
    );
    assert.equal((await confirmed(ctx)).length, 1);
    assert.equal(
      (await ctx.scheduling.list(ORG)).length,
      1,
      "no stray pending request was left behind",
    );
    assert.equal(ctx.notified.filter((r) => /request/i.test(r)).length, 0);

    const retry = await say(ctx, taken, "1");
    assert.match(texts(retry), /You're booked/);
    const all = await confirmed(ctx);
    assert.equal(all.length, 2);
    const [a, b] = all.sort((x, y) => x.startAt.localeCompare(y.startAt));
    assert.ok(
      Date.parse(a!.endAt) <= Date.parse(b!.startAt),
      "the two visits do not overlap",
    );
  });

  it("lets only one of two simultaneous callers have the same time", async () => {
    const ctx = setup();
    const first = await callToOffer(ctx, "CC1");
    const second = await callToOffer(
      ctx,
      "CC2",
      "tomorrow morning",
      "+15145558888",
    );

    const [a, b] = await Promise.all([
      say(ctx, first, "2"),
      say(ctx, second, "2"),
    ]);
    const spoken = [texts(a), texts(b)];
    assert.equal(spoken.filter((t) => /You're booked/.test(t)).length, 1);
    assert.equal(spoken.filter((t) => /just taken/.test(t)).length, 1);
    assert.equal((await confirmed(ctx)).length, 1);
    assert.equal(
      (await ctx.scheduling.list(ORG)).length,
      1,
      "the loser left no record",
    );
  });

  it("does not book twice when the same choice is delivered again", async () => {
    const ctx = setup();
    const offering = await callToOffer(ctx, "CD1");
    const session = (await ctx.store.getSession(offering.sessionId!))!;
    const chosen = session.booking!.offered[0]!;
    const reserve = () =>
      createPhoneScheduler({
        scheduling: async () => ctx.scheduling,
        findOrganizationId: async () => ORG,
      }).reserve({
        config: ctx.config,
        serviceId: session.booking!.serviceId,
        serviceName: session.booking!.serviceName,
        startAt: chosen.startAt,
        callerName: "Marie Tremblay",
        callbackE164: CALLER,
        serviceAddress: "123 Main Street",
        language: "en",
        idempotencyKey: `rcs:${session.id}:${chosen.startAt}`,
      });
    const first = await reserve();
    const again = await reserve();
    assert.equal(first.status, "confirmed");
    assert.equal(again.status, "confirmed");
    assert.equal(
      first.status === "confirmed" &&
        again.status === "confirmed" &&
        first.appointmentId === again.appointmentId,
      true,
    );
    assert.equal((await confirmed(ctx)).length, 1);
  });
});

describe("phone booking — when it cannot confirm, it says it is a request", () => {
  function assertRequestOnly(
    plan: VoicePlan,
    ctx: Ctx,
    then: () => Promise<void> | void = () => undefined,
  ) {
    assert.match(
      texts(plan),
      /I wasn't able to reserve a time automatically\. I've noted your request and someone from the team will call you to confirm an appointment\./,
    );
    assert.doesNotMatch(texts(plan), /You're booked/);
    assert.deepEqual(plan.verbs.at(-1), { verb: "hangup" });
    return (async () => {
      assert.equal((await confirmed(ctx)).length, 0, "nothing was confirmed");
      await then();
    })();
  }

  it("treats a calendar failure as a request and keeps nothing confirmed", async () => {
    const ctx = setup({ calendar: createSimulatedCalendar(true) });
    let plan = await callToOffer(ctx, "CE1");
    plan = await say(ctx, plan, "2");
    await assertRequestOnly(plan, ctx, async () => {
      const session = (await ctx.store.getSession(plan.sessionId!))!;
      assert.equal(session.outcome, "appointment_requested");
      assert.equal(session.booking?.status, "requested");
      assert.equal(session.booking?.fallbackReason, "calendar_error");
      assert.equal(
        session.slots.preferredTime,
        "Thursday, October 22 at 9:30 AM",
      );
      const rows = await ctx.scheduling.list(ORG);
      assert.deepEqual(
        rows
          .filter((r) => r.status === "pending")
          .map((r) => r.appointmentKind),
        ["request"],
        "the contractor sees one request to review",
      );
      assert.deepEqual(
        rows.filter((r) => r.status === "canceled").map((r) => r.cancelReason),
        ["calendar_sync_failed"],
        "the reservation that could not reach the calendar was rolled back",
      );
    });
  });

  it("never auto-confirms a service that needs approval", async () => {
    const ctx = setup();
    let plan = await ctx.engine.startCall({
      callSid: "CE2",
      fromE164: CALLER,
      toE164: OFFICE,
    });
    plan = await say(
      ctx,
      plan,
      "I want to book an appointment for a major installation",
    );
    plan = await say(ctx, plan, "Marie Tremblay");
    plan = await say(ctx, plan, "123 Main Street");
    plan = await say(ctx, plan, "yes");
    plan = await say(ctx, plan, "tomorrow morning");
    await assertRequestOnly(plan, ctx, async () => {
      assert.equal(
        (await ctx.scheduling.list(ORG)).length,
        0,
        "no booking, not even a pending one",
      );
      const session = (await ctx.store.getSession(plan.sessionId!))!;
      assert.equal(session.booking?.fallbackReason, "not_bookable");
    });
  });

  it("falls back when the schedule cannot be read", async () => {
    const ctx = setup({
      scheduler: (real) => ({
        reserve: real.reserve,
        listOpenings: async () => {
          throw new Error("database down");
        },
      }),
    });
    const plan = await callToOffer(ctx, "CE3");
    await assertRequestOnly(plan, ctx);
  });

  it("falls back when the reservation itself errors", async () => {
    const ctx = setup({
      scheduler: (real) => ({
        listOpenings: real.listOpenings,
        reserve: async () => {
          throw new Error("database down");
        },
      }),
    });
    let plan = await callToOffer(ctx, "CE4");
    plan = await say(ctx, plan, "1");
    await assertRequestOnly(plan, ctx, async () => {
      const session = (await ctx.store.getSession(plan.sessionId!))!;
      assert.equal(session.booking?.fallbackReason, "reserve_timeout");
    });
  });

  it("does not read out times a disconnected Google calendar could not confirm", async () => {
    const ctx = setup();
    const rules = await ctx.scheduling.getRules(ORG);
    await ctx.scheduling.saveRules({ ...rules, calendarMode: "google" });
    const plan = await callToOffer(ctx, "CE5");
    await assertRequestOnly(plan, ctx);
    assert.equal((await ctx.scheduling.list(ORG)).length, 0);
  });

  it("gives up after the caller refuses two lists of openings", async () => {
    const ctx = setup();
    let plan = await callToOffer(ctx, "CE6");
    plan = await say(ctx, plan, "none of those");
    assert.match(texts(plan), /Okay\. I also have: 1, /);
    plan = await say(ctx, plan, "no, none of those either");
    await assertRequestOnly(plan, ctx);
  });

  it("repeats the list once for an unclear answer, then falls back", async () => {
    const ctx = setup();
    let plan = await callToOffer(ctx, "CE7");
    plan = await say(ctx, plan, "hmm let me think");
    assert.match(texts(plan), /Sorry, I didn't catch that\. Again: 1, /);
    plan = await say(ctx, plan, "uh");
    await assertRequestOnly(plan, ctx);
  });

  it("repeats the openings after silence", async () => {
    const ctx = setup();
    const plan = await callToOffer(ctx, "CE8");
    const quiet = await ctx.engine.handleGather({
      sessionId: plan.sessionId!,
      speech: "",
    });
    assert.match(texts(quiet), /Again: 1, Thursday, October 22 at 8 AM/);
  });
});

describe("phone booking — off unless the owner turns it on", () => {
  const wrapUp =
    /I've noted your request and someone from the team will call you back/;

  it("only captures the requested time when phoneBooking is off", async () => {
    const ctx = setup({ config: makeConfig({ phoneBooking: false }) });
    const plan = await callToOffer(ctx, "CF1");
    assert.match(texts(plan), wrapUp);
    assert.equal((await ctx.scheduling.list(ORG)).length, 0);
    const session = (await ctx.store.getSession(plan.sessionId!))!;
    assert.equal(session.outcome, "appointment_requested");
    assert.equal(session.slots.preferredTime, "tomorrow morning");
    assert.equal(session.booking, undefined);
  });

  it("does the same when there is no scheduling backend", async () => {
    const ctx = setup({ withScheduler: false });
    const plan = await callToOffer(ctx, "CF2");
    assert.match(texts(plan), wrapUp);
    assert.equal((await ctx.scheduling.list(ORG)).length, 0);
  });

  it("does not offer times for a message or a service request", async () => {
    const ctx = setup();
    let plan = await ctx.engine.startCall({
      callSid: "CF3",
      fromE164: CALLER,
      toE164: OFFICE,
    });
    plan = await say(ctx, plan, "my kitchen sink is leaking");
    plan = await say(ctx, plan, "Marie Tremblay");
    plan = await say(ctx, plan, "123 Main Street");
    plan = await say(ctx, plan, "yes");
    plan = await say(ctx, plan, "tomorrow morning");
    assert.doesNotMatch(texts(plan), /openings/);
    assert.equal((await ctx.scheduling.list(ORG)).length, 0);
  });

  it("is off by default in the owner's profile and the founder config", () => {
    assert.equal(appointmentSettingsSchema.parse({}).phoneBooking, false);
    assert.equal(
      defaultProfileSettings().appointmentSettings.phoneBooking,
      false,
    );
    assert.equal(
      parseReceptionistConfig({
        id: "x",
        clientAccountId: "c",
        phoneNumberE164: OFFICE,
        businessName: "B",
      }).phoneBooking,
      false,
    );

    const client = demoClientAccount({
      id: "client_a",
      contractorDisplayName: "Nord Plomberie",
    });
    const profile = (phoneBooking?: boolean) => ({
      organizationId: "org_a",
      phoneNumberE164: "+14385597100",
      activated: true,
      updatedAt: NOW.toISOString(),
      settings: profileSettingsSchema.parse({
        emergencyTransferE164: "+14385597003",
        fallbackTransferE164: "+14385597004",
        notifyEmail: "owner@example.com",
        appointmentSettings:
          phoneBooking === undefined ? undefined : { phoneBooking },
      }),
    });
    assert.equal(buildProfileConfig(profile(), { client }).phoneBooking, false);
    assert.equal(
      buildProfileConfig(profile(false), { client }).phoneBooking,
      false,
    );
    assert.equal(
      buildProfileConfig(profile(true), { client }).phoneBooking,
      true,
    );
  });
});

describe("phone booking — records", () => {
  it("clears booking details when the transcript is purged", async () => {
    const ctx = setup();
    let plan = await callToOffer(ctx, "CG1");
    plan = await say(ctx, plan, "1");
    await ctx.engine.handleCallStatus({
      callSid: "CG1",
      callStatus: "completed",
    });
    const session = (await ctx.store.getSession(plan.sessionId!))!;
    assert.ok(session.summary?.appointment);
    const redacted = redactSession(session, NOW.toISOString());
    assert.equal(redacted.booking, undefined);
    assert.equal(redacted.summary?.appointment, undefined);
  });

  it("summarises a request that never reached a reservation as a request", async () => {
    const config = makeConfig();
    const summary = buildCallSummary(config, {
      id: "s",
      callSid: "c",
      configId: config.id,
      clientAccountId: config.clientAccountId,
      fromE164: CALLER,
      toE164: OFFICE,
      language: "en",
      status: "completed",
      step: "done",
      intent: "appointment",
      outcome: "appointment_requested",
      afterHours: false,
      slots: { callerName: "Marie", preferredTime: "Friday" },
      booking: {
        status: "requested",
        timezone: TZ,
        offered: [],
        rounds: 1,
        misses: 0,
        fallbackReason: "declined_openings",
      },
      turns: [],
      silenceCount: 0,
      callerTurnCount: 1,
      transfers: [],
      notifications: [],
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      version: 1,
    });
    assert.equal(summary.appointment?.status, "requested");
    assert.equal(summary.outcome, "appointment_requested");
    assert.match(summary.headline, /Appointment request/);
  });
});
