// Characterization tests for the pure helpers KAN-30 moved out of the
// receptionist engine closure (voice-plans.ts and call-session.ts). The
// behaviour is the engine's, unchanged; these pin the parts no end-to-end
// receptionist scenario reached (callback-number keypad entry, urgency
// never downgrading, the after-hours emergency rule).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import {
  bareSession,
  cleanDuration,
  emergencyTransferAllowed,
  mergeFlags,
  mergeUrgency,
} from "../../src/product/receptionist/call-session";
import {
  afterHoursNotice,
  appendEnglishHint,
  hangupPlan,
  listen,
  openingFor,
  say,
  sipHandoffPlan,
} from "../../src/product/receptionist/voice-plans";
import { DEFAULT_LANGUAGE_SELECT_TIMEOUT_SECONDS } from "../../src/product/receptionist/language-select";
import type {
  CallSession,
  CallStep,
  ReceptionistConfig,
  VoicePlan,
} from "../../src/product/receptionist/types";
import type { UrgencyClassification } from "../../src/product/missed-call/types";

const OFFICE = "+15145550000";
const CALLER = "+15145559876";
// Wednesday 2026-03-04 15:00 UTC = 10:00 Toronto (open); 03:00 UTC = 22:00 Tuesday (closed).
const OPEN_HOURS = new Date("2026-03-04T15:00:00Z");
const AFTER_HOURS = new Date("2026-03-04T03:00:00Z");

function makeConfig(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_test",
    clientAccountId: "client_test",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "fr",
    routing: [],
    faqs: [],
    emergencyTransferE164: "+15145550302",
    notifications: [{ type: "sms", toE164: "+15145550304" }],
    ...over,
  });
}

function session(
  config: ReceptionistConfig,
  step: CallStep,
  extra: Partial<CallSession> = {},
): CallSession {
  return bareSession(
    config,
    { callSid: "CA_test", fromE164: CALLER, toE164: OFFICE },
    OPEN_HOURS,
    { step, ...extra },
  );
}

const urgency = (
  level: UrgencyClassification["level"],
  source: string = level,
): UrgencyClassification => ({
  level,
  source,
  requiresHuman: false,
  escalated: false,
});

describe("listen (gather verb)", () => {
  const config = makeConfig();
  const prompt = [{ text: "Quel est votre numéro?" }];

  it("callback-number step takes keypad entry of ten digits", () => {
    const verb = listen(config, session(config, "callback_number"), prompt);
    assert.equal(verb.verb, "gather");
    if (verb.verb !== "gather") return;
    assert.deepEqual(verb.input, ["speech", "dtmf"]);
    assert.equal(verb.numDigits, 10);
  });

  it("offer-slot step takes a single key", () => {
    const verb = listen(config, session(config, "offer_slot"), prompt);
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.deepEqual(verb.input, ["speech", "dtmf"]);
    assert.equal(verb.numDigits, 1);
  });

  it("callback step allows keypad without a digit count", () => {
    const verb = listen(config, session(config, "callback"), prompt);
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.deepEqual(verb.input, ["speech", "dtmf"]);
    assert.equal(verb.numDigits, undefined);
  });

  it("language menu takes one key and waits only briefly", () => {
    const verb = listen(config, session(config, "language"), prompt);
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.deepEqual(verb.input, ["speech", "dtmf"]);
    assert.equal(verb.numDigits, 1);
    assert.equal(verb.timeoutSeconds, DEFAULT_LANGUAGE_SELECT_TIMEOUT_SECONDS);
  });

  it("an ordinary question is speech-only with the standard timeout", () => {
    const verb = listen(config, session(config, "reason"), prompt);
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.deepEqual(verb.input, ["speech"]);
    assert.equal(verb.numDigits, undefined);
    assert.equal(verb.timeoutSeconds, 6);
  });

  it("after the English hint, a lone key is still listened for", () => {
    const s = session(config, "reason", { flags: { englishHinted: true } });
    const verb = listen(config, s, prompt);
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.deepEqual(verb.input, ["speech", "dtmf"]);
    assert.equal(verb.numDigits, undefined);
  });

  it("an explicit digit count wins over the step's", () => {
    const verb = listen(config, session(config, "callback_number"), prompt, { dtmfDigits: 4 });
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.equal(verb.numDigits, 4);
    assert.deepEqual(verb.input, ["speech", "dtmf"]);
  });

  it("drops blank prompts and voices each in its own language", () => {
    const verb = listen(config, session(config, "reason"), [
      { text: "Bonjour" },
      { text: "   " },
      { text: "For English, press 1.", lang: "en" },
    ]);
    if (verb.verb !== "gather") return assert.fail("not a gather");
    assert.deepEqual(
      verb.prompts.map((p) => [p.text, p.language, p.voice]),
      [
        ["Bonjour", "fr", config.voices.fr],
        ["For English, press 1.", "en", config.voices.en],
      ],
    );
  });
});

describe("fixed voice plans", () => {
  const config = makeConfig();

  it("say uses the language's voice and the configured speed", () => {
    assert.deepEqual(say(config, "en", "Hi"), {
      verb: "say",
      text: "Hi",
      language: "en",
      voice: config.voices.en,
      speed: config.speakingSpeed,
    });
  });

  it("hangup and SIP hand-off plans", () => {
    assert.deepEqual(hangupPlan(null), { sessionId: null, verbs: [{ verb: "hangup" }] });
    const s = session(config, "reason");
    assert.deepEqual(sipHandoffPlan(config, s), {
      sessionId: s.id,
      verbs: [
        { verb: "sip_handoff", next: "dial", target: "livekit", calledE164: OFFICE, timeoutSeconds: 20 },
      ],
    });
  });

  it("appendEnglishHint adds the English prompt to the last gather only", () => {
    const s = session(config, "reason");
    const plan: VoicePlan = {
      sessionId: s.id,
      verbs: [listen(config, s, [{ text: "Un" }]), listen(config, s, [{ text: "Deux" }])],
    };
    appendEnglishHint(config, plan);
    const [first, last] = plan.verbs;
    if (first.verb !== "gather" || last.verb !== "gather") return assert.fail("not gathers");
    assert.equal(first.prompts.length, 1);
    assert.equal(last.prompts.length, 2);
    assert.equal(last.prompts[1].language, "en");
    assert.equal(last.prompts[1].voice, config.voices.en);

    const noGather: VoicePlan = { sessionId: null, verbs: [{ verb: "hangup" }] };
    appendEnglishHint(config, noGather);
    assert.deepEqual(noGather.verbs, [{ verb: "hangup" }]);
  });

  it("a bilingual line opens on the French language menu", () => {
    const opening = openingFor(config, true);
    assert.equal(opening.step, "language");
    assert.equal(opening.language, "fr");
    assert.ok(opening.prompts.length >= 2);
  });

  it("a one-language line opens on the question, with the after-hours notice only when closed", () => {
    const single = makeConfig({ languages: ["en"], defaultLanguage: "en" });
    const open = openingFor(single, false);
    const closed = openingFor(single, true);
    assert.equal(open.step, "reason");
    assert.equal(closed.step, "reason");
    assert.equal(closed.prompts.length, open.prompts.length + 1);
    const s = session(single, "reason", { afterHours: true, language: "en" });
    assert.equal(closed.prompts[1].text, afterHoursNotice(single, s));
    assert.equal(afterHoursNotice(single, { ...s, afterHours: false }), "");
  });
});

describe("call-session helpers", () => {
  it("cleanDuration keeps only plausible provider durations, rounded", () => {
    assert.equal(cleanDuration(42.6), 43);
    assert.equal(cleanDuration(0), 0);
    assert.equal(cleanDuration(24 * 3600), 24 * 3600);
    for (const bad of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 24 * 3600 + 1]) {
      assert.equal(cleanDuration(bad), undefined, String(bad));
    }
  });

  it("mergeUrgency only ever escalates", () => {
    const routine = urgency("routine");
    const priority = urgency("priority");
    const critical = urgency("critical");
    assert.equal(mergeUrgency(undefined, routine), routine);
    assert.equal(mergeUrgency(routine, critical), critical);
    assert.equal(mergeUrgency(critical, routine), critical);
    assert.equal(mergeUrgency(critical, priority), critical);
    const again = urgency("priority", "second");
    assert.equal(mergeUrgency(priority, again), priority, "a tie keeps the first classification");
  });

  it("mergeFlags layers new flags over the session's", () => {
    const config = makeConfig();
    const s = session(config, "reason", { flags: { pricingAsked: true } });
    assert.deepEqual(mergeFlags(s, { scopeAsked: true }), { pricingAsked: true, scopeAsked: true });
    assert.equal(mergeFlags(s, undefined), s.flags);
  });

  it("emergency transfer: always in hours, after hours only in the emergency mode, never without a number", () => {
    const takeMessage = makeConfig({ afterHoursMode: "take_message" });
    const emergency = makeConfig({ afterHoursMode: "take_message_emergency_transfer" });
    const noNumber = makeConfig({ emergencyTransferE164: undefined });
    const inHours = (c: ReceptionistConfig) => session(c, "reason", { afterHours: false });
    const closed = (c: ReceptionistConfig) => session(c, "reason", { afterHours: true });
    assert.equal(emergencyTransferAllowed(takeMessage, inHours(takeMessage)), true);
    assert.equal(emergencyTransferAllowed(takeMessage, closed(takeMessage)), false);
    assert.equal(emergencyTransferAllowed(emergency, closed(emergency)), true);
    assert.equal(emergencyTransferAllowed(noNumber, inHours(noNumber)), false);
  });

  it("bareSession starts a quiet, in-progress record at the given time", () => {
    const config = makeConfig();
    const s = bareSession(
      config,
      { callSid: "CA1", fromE164: CALLER, toE164: OFFICE },
      AFTER_HOURS,
      { status: "completed" },
    );
    assert.match(s.id, /^rcs_/);
    assert.equal(s.callSid, "CA1");
    assert.equal(s.configId, config.id);
    assert.equal(s.clientAccountId, config.clientAccountId);
    assert.equal(s.language, config.defaultLanguage);
    assert.equal(s.status, "completed");
    assert.equal(s.step, "reason");
    assert.equal(s.afterHours, true);
    assert.deepEqual(s.routing, { quiet: true });
    assert.equal(s.startedAt, AFTER_HOURS.toISOString());
    assert.equal(s.version, 1);
  });
});
