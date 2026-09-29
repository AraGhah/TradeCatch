import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createLlmBrain } from "../../src/product/receptionist/brain-llm";
import {
  deriveConfigFromClient,
  loadReceptionistConfigsFromEnv,
  parseReceptionistConfig,
  validateReceptionistConfig,
} from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import type { LlmClient } from "../../src/product/receptionist/llm";
import {
  detectLanguage,
  detectYesNo,
  extractName,
  extractPhoneE164,
  matchFaq,
} from "../../src/product/receptionist/nlu";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import {
  createMemoryReceptionistStore,
} from "../../src/product/receptionist/store";
import type {
  CallSession,
  ReceptionistBrain,
  ReceptionistConfig,
  VoicePlan,
} from "../../src/product/receptionist/types";
import {
  renderTwiml,
  runVoicePlanLoop,
  type ImperativeVoiceChannel,
} from "../../src/product/receptionist/voice";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

const OFFICE = "+15145550000";
const CALLER = "+15145559876";

// Wednesday 2026-03-04 15:00 UTC = 10:00 Toronto (inside 08:00–17:00 Mon–Fri).
const OPEN_HOURS = new Date("2026-03-04T15:00:00Z");
// Same day 03:00 UTC = 22:00 Tuesday Toronto (after hours).
const AFTER_HOURS = new Date("2026-03-04T03:00:00Z");

function makeConfig(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_test",
    clientAccountId: "client_test",
    phoneNumberE164: OFFICE,
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "fr",
    routing: [
      { id: "billing", name: "Facturation", phoneE164: "+15145550301", keywords: ["facture", "billing"] },
    ],
    faqs: [
      {
        id: "hours",
        keywords: ["heures d'ouverture", "opening hours"],
        answerFr: "Nous sommes ouverts du lundi au vendredi, de 8 h à 17 h.",
        answerEn: "We are open Monday to Friday, 8 a.m. to 5 p.m.",
      },
    ],
    emergencyTransferE164: "+15145550302",
    fallbackTransferE164: "+15145550303",
    notifications: [
      { type: "sms", toE164: "+15145550304" },
      { type: "email", to: "owner@example.com" },
    ],
    ...over,
  });
}

function setup(opts: { at?: Date; config?: ReceptionistConfig; brain?: ReceptionistBrain } = {}) {
  const config = opts.config ?? makeConfig();
  const store = createMemoryReceptionistStore();
  const sms = createMemorySmsPort();
  const emails: { toEmail: string; subject: string }[] = [];
  const recovered: string[] = [];
  const at = { current: opts.at ?? OPEN_HOURS };
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: opts.brain ?? createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms,
      sendEmail: async (input) => {
        emails.push({ toEmail: input.toEmail, subject: input.subject });
        return { sent: true };
      },
    }),
    clock: { now: () => at.current },
    onIncompleteCall: async (input) => {
      recovered.push(input.callerE164);
    },
  });
  return { engine, store, sms, emails, recovered, config, at };
}

async function say(
  engine: ReturnType<typeof setup>["engine"],
  plan: VoicePlan,
  speech: string,
  digits?: string,
) {
  assert.ok(plan.sessionId, "plan has a session");
  return engine.handleGather({ sessionId: plan.sessionId!, speech, digits });
}

function texts(plan: VoicePlan): string {
  return plan.verbs
    .flatMap((v) => (v.verb === "say" ? [v.text] : v.verb === "gather" ? v.prompts.map((p) => p.text) : []))
    .join(" | ");
}

describe("receptionist NLU", () => {
  it("detects language from the menu, digits and function words", () => {
    assert.equal(detectLanguage("", "1"), "fr");
    assert.equal(detectLanguage("", "2"), "en");
    assert.equal(detectLanguage("English please"), "en");
    assert.equal(detectLanguage("j'ai besoin d'un plombier"), "fr");
    assert.equal(detectLanguage("I have a leak in my kitchen"), "en");
    assert.equal(detectLanguage("hmm"), null);
  });

  it("handles yes/no in both languages", () => {
    assert.equal(detectYesNo("oui, c'est correct"), "yes");
    assert.equal(detectYesNo("non merci"), "no");
    assert.equal(detectYesNo("non, c'est correct"), "no");
    assert.equal(detectYesNo("yeah that's right"), "yes");
    assert.equal(detectYesNo("peut-être"), null);
  });

  it("extracts names and phone numbers", () => {
    assert.equal(extractName("je m'appelle marie tremblay."), "Marie Tremblay");
    assert.equal(extractName("My name is John Smith"), "John Smith");
    assert.equal(extractPhoneE164("cinq un quatre 555 1234", undefined), "+15145551234");
    assert.equal(extractPhoneE164("", "5145551234"), "+15145551234");
    assert.equal(extractPhoneE164("12345", undefined), null);
  });

  it("matches FAQ keywords without accents", () => {
    const cfg = makeConfig();
    assert.equal(matchFaq("Quelles sont vos heures d'ouverture?", cfg.faqs)?.id, "hours");
    assert.equal(matchFaq("je veux une soumission", cfg.faqs), null);
  });
});

describe("receptionist config", () => {
  it("fills bilingual defaults and validates production safety", () => {
    const cfg = makeConfig();
    assert.match(cfg.greetingFr, /Nord Plomberie/);
    assert.match(cfg.greetingEn, /Nord Plomberie/);
    assert.equal(cfg.voices.fr, "Polly.Gabrielle-Neural");
    // Fictional 555 numbers are reserved demo numbers, so they never validate.
    assert.match(validateReceptionistConfig(cfg).errors.join(";"), /reserved demo/);

    const real = makeConfig({
      phoneNumberE164: "+14385597001",
      routing: [{ id: "billing", name: "Facturation", phoneE164: "+14385597002", keywords: ["facture"] }],
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      notifications: [{ type: "email", to: "owner@example.com" }],
    });
    assert.deepEqual(validateReceptionistConfig(real), { ok: true, errors: [] });

    const noHuman = makeConfig({ emergencyTransferE164: undefined, fallbackTransferE164: undefined });
    assert.match(validateReceptionistConfig(noHuman).errors.join(";"), /live human/);
  });

  it("rejects invalid configs with readable errors", () => {
    assert.throws(
      () => parseReceptionistConfig({ id: "x", clientAccountId: "c", phoneNumberE164: "5145550000", businessName: "A" }),
      /phoneNumberE164/,
    );
  });

  it("derives a profile from the Module A client and refuses demo config in production", () => {
    const client = demoClientAccount();
    const derived = deriveConfigFromClient(client, {} as NodeJS.ProcessEnv);
    assert.equal(derived.clientAccountId, client.id);
    assert.ok(derived.emergencyTransferE164);

    assert.deepEqual(loadReceptionistConfigsFromEnv(client, {} as NodeJS.ProcessEnv), []);
    assert.equal(
      loadReceptionistConfigsFromEnv(client, { RECEPTIONIST_ENABLED: "1" } as unknown as NodeJS.ProcessEnv).length,
      1,
    );
    assert.throws(
      () =>
        loadReceptionistConfigsFromEnv(client, {
          RECEPTIONIST_ENABLED: "1",
          NODE_ENV: "production",
        } as unknown as NodeJS.ProcessEnv),
      /Invalid production config/,
    );
  });
});

describe("receptionist call flow (rule brain)", () => {
  it("runs a full French service-request call, then summarizes and notifies", async () => {
    const { engine, store, sms, emails } = setup();

    let plan = await engine.startCall({ callSid: "CA1", fromE164: CALLER, toE164: OFFICE });
    assert.ok(plan.verbs[0]!.verb === "gather");
    assert.match(texts(plan), /Nord Plomberie/);
    assert.match(texts(plan), /appuyez sur 1/);
    assert.match(texts(plan), /press 2/);

    plan = await say(engine, plan, "", "1"); // French
    assert.match(texts(plan), /Comment puis-je vous aider/);

    plan = await say(engine, plan, "j'ai un évier qui coule depuis hier");
    assert.match(texts(plan), /nom/);

    plan = await say(engine, plan, "je m'appelle Marie Tremblay");
    assert.match(texts(plan), /adresse/);

    plan = await say(engine, plan, "123 rue Saint-Denis à Montréal");
    assert.match(texts(plan), /bon numéro/); // callback confirmation uses the caller id

    plan = await say(engine, plan, "oui");
    assert.match(texts(plan), /moment/);

    plan = await say(engine, plan, "demain matin");
    assert.equal(plan.verbs.at(-1)!.verb, "hangup");
    assert.match(texts(plan), /Marie Tremblay/);

    const session = (await store.getSessionByCallSid("CA1"))!;
    assert.equal(session.slots.callerName, "Marie Tremblay");
    assert.equal(session.slots.callbackE164, CALLER);
    assert.equal(session.slots.preferredTime, "demain matin");
    assert.equal(session.outcome, "message_taken");

    const done = await engine.handleCallStatus({ callSid: "CA1", callStatus: "completed", durationSeconds: 71 });
    assert.equal(done.finalized, true);
    assert.equal(done.session!.summary!.outcome, "message_taken");
    assert.match(done.session!.summary!.nextStep, new RegExp(CALLER.replace("+", "\\+")));
    assert.equal(sms.sent.length, 1);
    assert.match(sms.sent[0]!.body, /Marie Tremblay/);
    assert.equal(emails.length, 1);
    assert.equal(done.session!.notifications.filter((n) => n.ok).length, 2);
  });

  it("answers an FAQ, then closes on 'no'", async () => {
    const { engine, store } = setup();
    let plan = await engine.startCall({ callSid: "CA2", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "2"); // English
    plan = await say(engine, plan, "what are your opening hours?");
    assert.match(texts(plan), /Monday to Friday/);
    plan = await say(engine, plan, "no thanks");
    assert.equal(plan.verbs.at(-1)!.verb, "hangup");
    const s = (await store.getSessionByCallSid("CA2"))!;
    assert.equal(s.language, "en");
    assert.equal(s.outcome, "faq_answered");
  });

  it("does not finalize twice and does not double-notify", async () => {
    const { engine, sms } = setup();
    let plan = await engine.startCall({ callSid: "CA3", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    await say(engine, plan, "besoin d'un plombier");
    await Promise.all([
      engine.handleCallStatus({ callSid: "CA3", callStatus: "completed" }),
      engine.handleCallStatus({ callSid: "CA3", callStatus: "completed" }),
    ]);
    await engine.handleCallStatus({ callSid: "CA3", callStatus: "completed" });
    assert.equal(sms.sent.length, 1);
  });

  it("is idempotent when Twilio retries the incoming webhook", async () => {
    const { engine, store } = setup();
    await engine.startCall({ callSid: "CA4", fromE164: CALLER, toE164: OFFICE });
    const again = await engine.startCall({ callSid: "CA4", fromE164: CALLER, toE164: OFFICE });
    assert.ok(again.verbs[0]!.verb === "gather");
    assert.equal((await store.listSessions({})).length, 1);
  });

  it("asks for a callback number when the caller id is unusable", async () => {
    const { engine } = setup();
    let plan = await engine.startCall({ callSid: "CA5", fromE164: "anonymous", toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await say(engine, plan, "fuite au sous-sol");
    plan = await say(engine, plan, "Luc Roy");
    plan = await say(engine, plan, "55 rue Principale");
    assert.match(texts(plan), /10 chiffres/);
    plan = await say(engine, plan, "", "4505551122");
    assert.match(texts(plan), /moment/);
  });

  it("reprompts once on silence, then falls back to voicemail", async () => {
    const { engine } = setup();
    let plan = await engine.startCall({ callSid: "CA6", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await say(engine, plan, "");
    assert.match(texts(plan), /n'ai pas bien entendu/);
    plan = await say(engine, plan, "");
    assert.equal(plan.verbs.some((v) => v.verb === "record"), true);

    plan = await engine.handleVoicemail({ sessionId: plan.sessionId!, recordingUrl: "https://api.twilio.com/rec/RE1" });
    assert.equal(plan.verbs.at(-1)!.verb, "hangup");
    const done = await engine.handleCallStatus({ callSid: "CA6", callStatus: "completed" });
    assert.equal(done.session!.outcome, "voicemail");
    assert.equal(done.session!.recordingUrl, "https://api.twilio.com/rec/RE1");
  });
});

describe("receptionist transfers, hours and emergencies", () => {
  it("transfers to a named department during business hours and records the result", async () => {
    const { engine, store } = setup();
    let plan = await engine.startCall({ callSid: "CB1", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await say(engine, plan, "je voudrais parler à la facturation");
    const dial = plan.verbs.find((v) => v.verb === "dial");
    assert.ok(dial && dial.verb === "dial" && dial.phoneE164 === "+15145550301");

    plan = await engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "completed", durationSeconds: 90 });
    assert.equal(plan.verbs[0]!.verb, "hangup");
    const s = (await store.getSessionByCallSid("CB1"))!;
    assert.equal(s.outcome, "transferred");
    assert.equal(s.transfers[0]!.status, "completed");
  });

  it("falls back to taking a message when the transfer target does not answer", async () => {
    const { engine } = setup();
    let plan = await engine.startCall({ callSid: "CB2", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await say(engine, plan, "billing please");
    plan = await engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer" });
    assert.equal(plan.verbs[0]!.verb, "gather");
    assert.match(texts(plan), /n'est pas disponible/);
    assert.match(texts(plan), /Comment puis-je vous aider/);
  });

  it("never transfers to departments after hours and greets with the closed message", async () => {
    const { engine, store } = setup({ at: AFTER_HOURS });
    let plan = await engine.startCall({ callSid: "CB3", fromE164: CALLER, toE164: OFFICE });
    assert.equal((await store.getSessionByCallSid("CB3"))!.afterHours, true);
    plan = await say(engine, plan, "", "1");
    assert.match(texts(plan), /fermés/);
    plan = await say(engine, plan, "je veux parler à la facturation");
    assert.equal(plan.verbs.some((v) => v.verb === "dial"), false);
    assert.match(texts(plan), /personne au bureau/);
    // The wrap-up promises a callback at opening, not "soon".
    plan = await say(engine, plan, "Luc Roy");
    plan = await say(engine, plan, "oui");
    assert.match(texts(plan), /dès l'ouverture/);
  });

  it("bridges a critical emergency to the on-call line immediately and alerts by SMS", async () => {
    const deferred: (() => Promise<void>)[] = [];
    const { engine, store, sms } = setup({ at: AFTER_HOURS });
    let plan = await engine.startCall({ callSid: "CB4", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await engine.handleGather({
      sessionId: plan.sessionId!,
      speech: "je sens une odeur de gaz dans la maison",
      defer: (task) => deferred.push(task),
    });
    const dial = plan.verbs.find((v) => v.verb === "dial");
    assert.ok(dial && dial.verb === "dial" && dial.phoneE164 === "+15145550302");
    assert.match(texts(plan), /9-1-1/);

    await Promise.all(deferred.map((t) => t()));
    assert.equal(sms.sent.length, 1);
    assert.match(sms.sent[0]!.body, /URGENT/);
    assert.equal(sms.sent[0]!.toE164, "+15145550304");

    plan = await engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "completed" });
    const s = (await store.getSessionByCallSid("CB4"))!;
    assert.equal(s.outcome, "emergency_transferred");
    assert.equal(s.urgency!.level, "critical");

    const done = await engine.handleCallStatus({ callSid: "CB4", callStatus: "completed" });
    assert.match(done.session!.summary!.headline, /URGENCE|EMERGENCY/i);
    assert.match(done.session!.summary!.nextStep, /URGENT/);
  });

  it("flags emergencies but keeps collecting when no on-call line exists", async () => {
    const config = makeConfig({ emergencyTransferE164: undefined });
    const { engine, sms } = setup({ config });
    let plan = await engine.startCall({ callSid: "CB5", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "2");
    plan = await say(engine, plan, "there is a fire in the basement");
    assert.equal(plan.verbs.some((v) => v.verb === "dial"), false);
    assert.match(texts(plan), /9-1-1/);
    assert.match(texts(plan), /name/);
    assert.equal(sms.sent.length, 1);
  });

  it("hands hang-ups with no details to Module A SMS recovery", async () => {
    const { engine, recovered } = setup();
    await engine.startCall({ callSid: "CB6", fromE164: CALLER, toE164: OFFICE });
    const done = await engine.handleCallStatus({ callSid: "CB6", callStatus: "completed", durationSeconds: 6 });
    assert.deepEqual(recovered, [CALLER]);
    assert.ok(done.session!.smsRecoveryTriggeredAt);
    assert.equal(done.session!.outcome, "caller_hung_up");
  });

  it("finalizes lost calls and purges transcripts on tick", async () => {
    const config = makeConfig({ transcriptRetentionDays: 1 });
    const { engine, store, at } = setup({ config });
    let plan = await engine.startCall({ callSid: "CB7", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    await say(engine, plan, "besoin d'un plombier");

    at.current = new Date(OPEN_HOURS.getTime() + 60 * 60 * 1000);
    const first = await engine.tick();
    assert.equal(first.finalized, 1);

    at.current = new Date(OPEN_HOURS.getTime() + 3 * 24 * 60 * 60 * 1000);
    const second = await engine.tick();
    assert.equal(second.purged, 1);
    const s = (await store.getSessionByCallSid("CB7"))!;
    assert.equal(s.turns.length, 0);
    assert.deepEqual(s.slots, {});
    assert.ok(s.transcriptPurgedAt);
  });
});

describe("receptionist LLM brain guardrails", () => {
  function fakeLlm(response: unknown | (() => never)): LlmClient {
    return {
      provider: "openai",
      model: "fake",
      async generateJson() {
        if (typeof response === "function") return (response as () => never)();
        return response;
      },
      async generateText() {
        return "Résumé IA de test.";
      },
    };
  }

  it("uses the model's reply and merges validated slots", async () => {
    const llm = fakeLlm({
      reply: "Merci Marie. Quelle est l'adresse?",
      action: "ask",
      intent: "service_request",
      slots: { callerName: "Marie", issue: "évier qui coule", callbackE164: "not-a-phone" },
    });
    const { engine, store } = setup({ brain: createLlmBrain(llm) });
    let plan = await engine.startCall({ callSid: "CC1", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await say(engine, plan, "Bonjour, c'est Marie, mon évier coule");
    assert.match(texts(plan), /adresse/);
    const s = (await store.getSessionByCallSid("CC1"))!;
    assert.equal(s.slots.callerName, "Marie");
    assert.equal(s.slots.callbackE164, undefined, "invalid phone rejected");
    assert.equal(s.turns.at(-1)!.brain, "llm");
  });

  it("rejects a hallucinated transfer target and keeps collecting", async () => {
    const llm = fakeLlm({ reply: "Je vous transfère.", action: "transfer", transferTargetId: "ceo" });
    const { engine } = setup({ brain: createLlmBrain(llm) });
    let plan = await engine.startCall({ callSid: "CC2", fromE164: CALLER, toE164: OFFICE });
    plan = await say(engine, plan, "", "1");
    plan = await say(engine, plan, "je veux parler au grand patron");
    assert.equal(plan.verbs.some((v) => v.verb === "dial"), false);
    assert.match(texts(plan), /nom|aider/);
  });

  it("falls back to the rule brain when the model errors or returns junk", async () => {
    for (const bad of [() => { throw new Error("timeout"); }, { reply: "", action: "explode" }]) {
      const { engine, store } = setup({ brain: createLlmBrain(fakeLlm(bad as never)) });
      let plan = await engine.startCall({ callSid: `CC3_${Math.random()}`, fromE164: CALLER, toE164: OFFICE });
      plan = await say(engine, plan, "", "1");
      plan = await say(engine, plan, "fuite d'eau dans la cuisine");
      assert.match(texts(plan), /nom/);
      const [s] = await store.listSessions({});
      assert.equal(s!.turns.at(-1)!.brain, "rules");
    }
  });

  it("adds an AI summary to the call summary when an LLM is available", async () => {
    const llm = fakeLlm({ reply: "ok", action: "ask" });
    const config = makeConfig();
    const store = createMemoryReceptionistStore();
    const sms = createMemorySmsPort();
    const engine = createReceptionistEngine({
      store,
      configs: () => [config],
      brain: createRuleBrain(),
      llm,
      notifier: createReceptionistNotifier({ sms }),
      clock: { now: () => OPEN_HOURS },
    });
    let plan = await engine.startCall({ callSid: "CC4", fromE164: CALLER, toE164: OFFICE });
    plan = await engine.handleGather({ sessionId: plan.sessionId!, speech: "", digits: "1" });
    await engine.handleGather({ sessionId: plan.sessionId!, speech: "un problème de chauffe-eau" });
    const done = await engine.handleCallStatus({ callSid: "CC4", callStatus: "completed" });
    assert.equal(done.session!.summary!.aiSummary, "Résumé IA de test.");
  });
});

describe("voice rendering", () => {
  const cb = (step: string, id: string | null) => `https://x.test/api/twilio/voice/receptionist/${step}?session=${id}`;

  it("renders escaped TwiML with per-language voices", async () => {
    const { engine } = setup();
    const plan = await engine.startCall({ callSid: "CV1", fromE164: CALLER, toE164: OFFICE });
    const xml = renderTwiml(plan, cb);
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><Response><Gather /);
    assert.match(xml, /voice="Polly.Gabrielle-Neural" language="fr-CA"/);
    assert.match(xml, /voice="Polly.Joanna-Neural" language="en-US"/);
    assert.match(xml, /input="speech dtmf"/);
    assert.match(xml, /actionOnEmptyResult="true"/);
    assert.match(xml, /action="https:\/\/x\.test\/api\/twilio\/voice\/receptionist\/gather\?session=rcs_/);
  });

  it("escapes caller-influenced text and renders dial/record/hangup", () => {
    const plan: VoicePlan = {
      sessionId: "s1",
      verbs: [
        { verb: "say", text: `<Hangup/> & "x"`, language: "en", voice: "Polly.Joanna-Neural" },
        { verb: "dial", next: "dial", phoneE164: "+15145550301", timeoutSeconds: 25 },
        { verb: "record", next: "voicemail", maxLengthSeconds: 120 },
        { verb: "hangup" },
      ],
    };
    const xml = renderTwiml(plan, cb);
    assert.ok(xml.includes("&lt;Hangup/&gt; &amp; &quot;x&quot;"));
    assert.match(xml, /<Dial action="[^"]+"[^>]*timeout="25"><Number>\+15145550301<\/Number><\/Dial>/);
    assert.match(xml, /<Record action="[^"]+voicemail\?session=s1"/);
    assert.match(xml, /<Hangup\/><\/Response>$/);
  });

  it("drives a whole call through an imperative (Fonoster-style) channel", async () => {
    const { engine, store } = setup();
    const heard: string[] = [];
    const script = ["1", "fuite d'eau", "Luc Roy", "9 rue Sainte-Anne", "oui", "cet après-midi"];
    let i = 0;
    let hungUp = false;
    const channel: ImperativeVoiceChannel = {
      async say(text) {
        heard.push(text);
      },
      async gather(opts) {
        heard.push(...opts.prompts.map((p) => p.text));
        const next = script[i++] ?? "";
        return next === "1" ? { digits: "1" } : { speech: next };
      },
      async dial() {
        return { status: "completed" };
      },
      async record() {
        return {};
      },
      async hangup() {
        hungUp = true;
      },
    };

    const first = await engine.startCall({ callSid: "CV2", fromE164: CALLER, toE164: OFFICE });
    await runVoicePlanLoop(first, channel, {
      onGather: (g) => engine.handleGather({ sessionId: g.sessionId!, speech: g.speech, digits: g.digits }),
      onDial: (d) => engine.handleDialResult({ sessionId: d.sessionId!, dialStatus: d.status }),
      onVoicemail: (v) => engine.handleVoicemail({ sessionId: v.sessionId!, recordingUrl: v.recordingUrl }),
    });
    assert.equal(hungUp, true);
    const s = (await store.getSessionByCallSid("CV2"))!;
    assert.equal(s.slots.callerName, "Luc Roy");
    assert.equal(s.step, "done");
    assert.ok(heard.some((h) => /Luc Roy/.test(h)));
  });
});

describe("receptionist store", () => {
  it("uses optimistic concurrency", async () => {
    const store = createMemoryReceptionistStore();
    const base: CallSession = {
      id: "rcs_1",
      callSid: "CS1",
      configId: "rc",
      clientAccountId: "c",
      fromE164: CALLER,
      toE164: OFFICE,
      language: "fr",
      status: "in_progress",
      step: "reason",
      afterHours: false,
      slots: {},
      turns: [],
      silenceCount: 0,
      callerTurnCount: 0,
      transfers: [],
      notifications: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    const { session, created } = await store.insertSessionIfAbsent(base);
    assert.equal(created, true);
    const saved = await store.saveSession(session);
    assert.equal(saved.version, 2);
    await assert.rejects(() => store.saveSession(session), /concurrent update/);
  });
});
