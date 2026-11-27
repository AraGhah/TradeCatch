import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { IntlMessageFormat } from "intl-messageformat";
import { createTranslator } from "next-intl";
import { conflictKey } from "../../src/components/app/automation-client";
import {
  describeSchedule,
  formatDuration,
  formatHour,
  type Translate,
} from "../../src/components/app/automation-copy";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { defaultConfig } from "../../src/product/sms-automation/templates";
import {
  ATTENTION_WINDOW_MS,
  KNOWN_RESULTS,
  deriveAutomationState,
  splitMinutes,
  type JobSummary,
} from "../../src/product/sms-automation/status";
import {
  AUTOMATION_TYPES,
  TEMPLATE_KEYS,
  TEMPLATE_VARIABLES,
  type AutomationRecord,
  type JobStatus,
} from "../../src/product/sms-automation/types";

/**
 * KAN-24. The Automations copy is customer-facing, in two languages, and makes claims about
 * timing and consent. These tests keep it honest: every sentence is valid and matches in
 * both languages, no developer vocabulary leaks in, the words used on the screen exist, and
 * the status and schedule sentences follow the real rules and defaults.
 */

type Tree = { [key: string]: string | Tree };
const EN = (en as unknown as { app: { automations: Tree } }).app.automations;
const FR = (fr as unknown as { app: { automations: Tree } }).app.automations;

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const FLAT = { en: flatten(EN), fr: flatten(FR) };

function translator(locale: "en" | "fr", namespace = "app.automations"): Translate {
  const messages = locale === "en" ? en : fr;
  // The catalog is far too large to type-check against a namespace chosen at run time.
  return createTranslator({ locale, messages, namespace } as never) as unknown as Translate;
}

/** The names inside {braces} of an ICU message, ignoring the words inside plural/select branches. */
function placeholders(message: string): string[] {
  const ast = new IntlMessageFormat(message, "en").getAst();
  const names = new Set<string>();
  const walk = (nodes: unknown[]) => {
    for (const node of nodes as Array<{ type: number; value?: string; options?: Record<string, { value: unknown[] }> }>) {
      // 0 literal, 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural, 7 pound, 8 tag
      if (node.type !== 0 && node.type !== 7 && node.value) names.add(node.value);
      if (node.options) for (const option of Object.values(node.options)) walk(option.value);
    }
  };
  walk(ast as unknown[]);
  return [...names].sort();
}

describe("the Automations copy is valid and matches in both languages", () => {
  it("has the same keys in English and French", () => {
    assert.deepEqual(Object.keys(FLAT.en).sort(), Object.keys(FLAT.fr).sort());
  });

  it("every sentence is valid message syntax, and has no empty text", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const [key, message] of Object.entries(FLAT[locale])) {
        assert.ok(message.trim().length > 0, `${locale}.${key} is empty`);
        assert.doesNotThrow(() => new IntlMessageFormat(message, locale), `${locale}.${key} is not valid`);
      }
    }
  });

  it("French fills in exactly the same details as English, in every sentence", () => {
    for (const key of Object.keys(FLAT.en)) {
      assert.deepEqual(placeholders(FLAT.fr[key]!), placeholders(FLAT.en[key]!), `placeholders differ at ${key}`);
    }
  });

  it("uses the headings and descriptions the ticket asked for, word for word", () => {
    assert.equal(EN.headline, "Automatic Follow-Ups");
    assert.equal(FR.headline, "Suivis automatiques");
    assert.equal(
      EN.intro,
      "Never miss an opportunity. Automatically follow up with customers, send quote reminders, and stay connected without lifting a finger. TradeCatch handles everything for you, even when you're offline.",
    );
    assert.equal(
      FR.intro,
      "Ne manquez plus aucune occasion. Relancez automatiquement vos clients, envoyez des rappels de soumission et gardez le contact sans effort. TradeCatch s'occupe des suivis, même lorsque vous n'êtes pas disponible.",
    );
    const d = (EN.descriptions as Tree);
    assert.equal(d.missed_call_recovery, "Missed a call? TradeCatch can automatically send a message so you don't lose a potential customer.");
    assert.equal(d.quote_followup, "Automatically remind customers about unanswered quotes and turn more opportunities into jobs.");
    const s = (EN.settings as Tree);
    assert.equal(s.scheduling, "Follow-Up Scheduling");
    assert.equal(s.schedulingHelp, "Choose when customers receive reminders. TradeCatch takes care of the rest.");
    const a = EN.actions as Tree;
    assert.deepEqual([a.enable, a.pause, a.save, a.history], ["Enable", "Pause", "Save Changes", "View History"]);
    const st = EN.status as Tree;
    assert.deepEqual([st.active, st.paused, st.scheduled, st.attention], ["Active", "Paused", "Scheduled", "Needs Attention"]);
  });
});

describe("no developer vocabulary reaches the customer", () => {
  const BANNED: Record<"en" | "fr", RegExp[]> = {
    en: [/\bbackend\b/i, /\bwebhooks?\b/i, /\bapi\b/i, /\btriggers?\b/i, /\bexecutions?\b/i, /\bpipelines?\b/i, /\bsms\b/i, /\bworkflows?\b/i, /\bproviders?\b/i, /\bhandsets?\b/i, /\bjobs? queue\b/i, /\bidempot/i, /\bthreadId\b/i, /\bAI\b/, /virtual assistant/i, /\bsegments?\b/i, /\bvariables?\b/i],
    fr: [/\bbackend\b/i, /\bwebhooks?\b/i, /\bapi\b/i, /\bd[ée]clencheurs?\b/i, /\bex[ée]cutions?\b/i, /\bpipelines?\b/i, /\bsms\b/i, /\bflux\b/i, /\bfournisseurs?\b/i, /\bserveur\b/i, /\bthreadId\b/i, /\bIA\b/, /assistant virtuel/i, /\bsegments?\b/i, /\bvariables?\b/i],
  };

  it("avoids the words the ticket names, and the other internal ones", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const [key, message] of Object.entries(FLAT[locale])) {
        for (const pattern of BANNED[locale]) {
          assert.ok(!pattern.test(message), `${locale}.${key} contains ${pattern}: "${message}"`);
        }
      }
    }
  });

  it("never shows an internal code (snake_case or camelCase) in a sentence", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const [key, message] of Object.entries(FLAT[locale])) {
        const visible = message.replace(/\{[^{}]*\}/g, "");
        assert.ok(!/\b[a-z]+_[a-z_]+\b/.test(visible), `${locale}.${key} shows a code: "${message}"`);
      }
    }
  });

  it("keeps the sentences short enough to read on a phone", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const [key, message] of Object.entries(FLAT[locale])) {
        const longest = Math.max(...message.split(/(?<=[.!?])\s+/).map((sentence) => sentence.length));
        assert.ok(longest <= 260, `${locale}.${key} has a ${longest}-character sentence`);
      }
    }
  });
});

describe("every word the screens ask for exists", () => {
  const NAMESPACES = [
    "app.automations",
    "app.automations.testPanel",
    "app.automations.status",
    "app.automations.statusHelp",
    "app.automations.jobStatus",
  ];
  const FILES = [
    "src/components/app/AutomationBoard.tsx",
    "src/components/app/AutomationSettingsForm.tsx",
    "src/components/app/AutomationStatus.tsx",
    "src/components/app/AutomationTestPanel.tsx",
    "src/components/app/TemplateManager.tsx",
    "src/components/app/automation-client.ts",
    "src/components/app/automation-copy.ts",
    "src/app/[locale]/app/automations/page.tsx",
    "src/app/[locale]/app/automations/missed-call/page.tsx",
    "src/app/[locale]/app/automations/quotes/page.tsx",
    "src/app/[locale]/app/automations/history/page.tsx",
    "src/app/[locale]/app/automations/templates/page.tsx",
  ];

  it("finds every literal key used in the screens, in both languages", () => {
    const known = (locale: "en" | "fr", key: string) =>
      NAMESPACES.some((namespace) => {
        const relative = namespace === "app.automations" ? key : `${namespace.replace("app.automations.", "")}.${key}`;
        return relative in FLAT[locale];
      });
    let checked = 0;
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\b(?:t|translate|statuses|tHelp)\(\s*"([A-Za-z0-9_.]+)"/g)) {
        const key = match[1]!;
        // `t("status")`-style calls with no dot are the translator of a nested namespace asking for a leaf.
        for (const locale of ["en", "fr"] as const) {
          assert.ok(known(locale, key), `${file}: "${key}" is missing in ${locale}`);
        }
        checked++;
      }
    }
    assert.ok(checked > 60, `only ${checked} keys were checked; the scan is not finding the calls`);
  });

  it("has a name, a description and either a status text or a coming-soon text for every automation", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const type of AUTOMATION_TYPES) {
        assert.ok(FLAT[locale][`names.${type}`], `${locale} names.${type}`);
        assert.ok(FLAT[locale][`descriptions.${type}`], `${locale} descriptions.${type}`);
      }
      for (const type of ["customer_reengagement", "urgent_lead_notification"]) {
        assert.ok(FLAT[locale][`soon.${type}`], `${locale} soon.${type}`);
      }
    }
  });

  it("explains every result the system can record, every job status and every template", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const result of KNOWN_RESULTS) assert.ok(FLAT[locale][`results.${result}`], `${locale} results.${result}`);
      for (const status of ["pending", "processing", "submitted", "sent", "delivered", "failed", "undelivered", "canceled", "skipped", "uncertain"] satisfies JobStatus[]) {
        assert.ok(FLAT[locale][`jobStatus.${status}`], `${locale} jobStatus.${status}`);
      }
      for (const key of TEMPLATE_KEYS) assert.ok(FLAT[locale][`templates.${key}`], `${locale} templates.${key}`);
      for (const name of TEMPLATE_VARIABLES) assert.ok(FLAT[locale][`templateUi.variableNames.${name}`], `${locale} variable ${name}`);
      for (const reason of ["switched_off_by_tradecatch", "no_number", "last_failed", "last_unconfirmed"]) {
        assert.ok(FLAT[locale][`statusHelp.attention.${reason}`], `${locale} attention ${reason}`);
      }
    }
  });

  it("covers every result the service can record, so no raw code is ever shown", () => {
    const source = readFileSync("src/product/sms-automation/service.ts", "utf8");
    const recorded = new Set<string>();
    for (const match of source.matchAll(/finish\(\s*job,\s*"[a-z]+",\s*"([a-z_]+)"/g)) recorded.add(match[1]!);
    for (const match of source.matchAll(/record\(\s*deps,\s*job,\s*"[a-z]+",\s*"([a-z_]+)"/g)) recorded.add(match[1]!);
    for (const match of source.matchAll(/return "(quote_[a-z_]+|customer_reply)"/g)) recorded.add(match[1]!);
    assert.ok(recorded.size > 15, `found only ${recorded.size} codes; the scan is not finding them`);
    for (const code of recorded) {
      assert.ok((KNOWN_RESULTS as readonly string[]).includes(code), `the service can record "${code}" but the screen has no words for it`);
    }
  });
});

describe("what a failed request says", () => {
  it("picks a sentence for the server's real 409 messages, never showing the server's own words", () => {
    const source = readFileSync("src/product/sms-automation/service.ts", "utf8");
    const real = [
      "Enable missed-call recovery before simulating.",
      "Enable quote follow-up before simulating.",
      "Enable missed-call recovery first.",
      "This workflow is not operational yet.",
    ];
    for (const message of real) assert.ok(source.includes(`"${message}"`), `the server no longer says "${message}"`);
    assert.equal(conflictKey(real[0]), "failures.turnOnFirst");
    assert.equal(conflictKey(real[1]), "failures.turnOnFirst");
    assert.equal(conflictKey(real[2]), "failures.turnOnFirst");
    assert.equal(conflictKey(real[3]), "failures.notAvailable");
    assert.equal(conflictKey("Something else entirely."), "failures.conflict");
    assert.equal(conflictKey(undefined), "failures.conflict");
  });
});

// ---------------------------------------------------------------------------------------

const NOW = new Date("2026-11-19T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    automationType: "missed_call_recovery",
    status: "pending",
    scheduledAt: ahead(MIN),
    updatedAt: ago(MIN),
    simulated: false,
    ...overrides,
  };
}

function state(
  enabled: boolean,
  jobs: JobSummary[] = [],
  extra: { senderReady?: boolean | null; off?: boolean; type?: AutomationRecord["type"] } = {},
) {
  return deriveAutomationState({
    automation: { type: extra.type ?? "missed_call_recovery", enabled },
    jobs,
    now: NOW,
    senderReady: extra.senderReady === undefined ? true : extra.senderReady,
    recoveryTextsSwitchedOff: extra.off ?? false,
  });
}

describe("the status is worked out from what the system actually holds", () => {
  it("is Paused whenever the switch is off, whatever else is true", () => {
    assert.equal(state(false).status, "paused");
    assert.equal(state(false, [job()], { senderReady: false, off: true }).status, "paused");
    assert.equal(state(false, [job({ status: "failed" })]).status, "paused");
  });

  it("is Active when it is on and nothing is waiting or wrong", () => {
    assert.deepEqual(state(true), { status: "active", waiting: 0 });
  });

  it("is Scheduled while real texts wait, and counts them with the next one due", () => {
    const result = state(true, [job({ scheduledAt: ahead(5 * MIN) }), job({ status: "processing", scheduledAt: ahead(MIN) })]);
    assert.equal(result.status, "scheduled");
    assert.equal(result.waiting, 2);
    assert.equal(result.nextAt, ahead(MIN));
  });

  it("ignores test texts and other automations when counting what waits", () => {
    assert.equal(state(true, [job({ simulated: true })]).status, "active");
    assert.equal(state(true, [job({ automationType: "quote_followup" })]).status, "active");
  });

  it("Needs Attention when TradeCatch has paused missed-call texts, but only for that automation", () => {
    assert.deepEqual(state(true, [], { off: true }).reason, "switched_off_by_tradecatch");
    assert.equal(state(true, [], { off: true }).status, "attention");
    assert.equal(state(true, [], { off: true, type: "quote_followup" }).status, "active");
  });

  it("Needs Attention when the business has no number to text from, but not when that is only unknown", () => {
    for (const type of ["missed_call_recovery", "quote_followup", "appointment_reminder"] as const) {
      const result = state(true, [], { senderReady: false, type });
      assert.equal(result.status, "attention", type);
      assert.equal(result.reason, "no_number", type);
    }
    assert.equal(state(true, [], { senderReady: null }).status, "active");
  });

  it("does not promise anything for the two automations that are not available yet", () => {
    assert.equal(state(true, [], { senderReady: false, type: "customer_reengagement" }).status, "active");
  });

  it("Needs Attention when the last real text failed or could not be confirmed, until a later one goes out", () => {
    assert.equal(state(true, [job({ status: "failed", updatedAt: ago(2 * MIN) })]).reason, "last_failed");
    assert.equal(state(true, [job({ status: "uncertain", updatedAt: ago(2 * MIN) })]).reason, "last_unconfirmed");
    const recovered = state(true, [
      job({ status: "failed", updatedAt: ago(10 * MIN) }),
      job({ status: "delivered", updatedAt: ago(MIN) }),
    ]);
    assert.equal(recovered.status, "active");
  });

  it("does not blame the automation for a bad number, an opt-out, a reply or a carrier refusal", () => {
    for (const status of ["canceled", "skipped", "undelivered"] as const) {
      assert.equal(state(true, [job({ status, updatedAt: ago(MIN) })]).status, "active", status);
    }
    assert.equal(state(true, [job({ status: "failed", lastError: "invalid_phone", updatedAt: ago(MIN) })]).status, "active");
  });

  it("lets an old failure go", () => {
    assert.equal(state(true, [job({ status: "failed", updatedAt: ago(ATTENTION_WINDOW_MS + DAY) })]).status, "active");
    assert.equal(state(true, [job({ status: "failed", updatedAt: ago(ATTENTION_WINDOW_MS - DAY) })]).status, "attention");
  });

  it("keeps a failure on top of waiting texts: it still needs a look", () => {
    const result = state(true, [job({ status: "failed", updatedAt: ago(MIN) }), job()]);
    assert.equal(result.status, "attention");
    assert.equal(result.waiting, 1);
  });
});

describe("the timing sentences say what the scheduler really does", () => {
  const record = (type: AutomationRecord["type"], config: Partial<AutomationRecord["config"]> = {}) => ({
    type,
    config: { ...defaultConfig(type), ...config },
  });

  it("describes the default missed-call follow-up: one text after 2 minutes, at any hour", () => {
    assert.deepEqual(describeSchedule(record("missed_call_recovery"), translator("en"), "en"), [
      "When a call goes unanswered, one text is sent about 2 minutes later.",
      "Quiet hours are off, so the caller gets the text at any hour.",
    ]);
    assert.deepEqual(describeSchedule(record("missed_call_recovery"), translator("fr", "app.automations"), "fr"), [
      "Lorsqu'un appel reste sans réponse, un texto est envoyé environ 2 minutes plus tard.",
      "Les heures de silence sont désactivées : l'appelant reçoit le texto à toute heure.",
    ]);
  });

  it("describes a missed-call follow-up with no delay and with quiet hours on", () => {
    const lines = describeSchedule(
      record("missed_call_recovery", { initialDelayMinutes: 0, respectQuietHours: true, weekendSending: false }),
      translator("en"),
      "en",
    );
    assert.equal(lines[0], "When a call goes unanswered, one text is sent right away.");
    assert.equal(lines[1], "Quiet hours are on. A call missed outside 8 AM to 8 PM, or on a weekend, gets no text.");
  });

  it("describes the default quote reminders: 1 day and 5 days, between 8 AM and 8 PM, not on weekends", () => {
    assert.deepEqual(describeSchedule(record("quote_followup"), translator("en"), "en"), [
      "If a quote is still unanswered, reminders are sent 1 day and 5 days after you send it.",
      "Texts only go out between 8 AM and 8 PM, not on weekends. A text due outside those hours waits until they open.",
    ]);
    assert.deepEqual(describeSchedule(record("quote_followup"), translator("fr"), "fr"), [
      "Si une soumission reste sans réponse, des rappels sont envoyés 1 jour et 5 jours après son envoi.",
      "Les textos sont envoyés seulement entre 8 h et 20 h, sauf la fin de semaine. Un texto prévu en dehors de ces heures attend leur reprise.",
    ]);
  });

  it("says one reminder when only one attempt is allowed, and follows the stored delays", () => {
    const one = describeSchedule(record("quote_followup", { maxAttempts: 1, initialDelayMinutes: 90 }), translator("en"), "en");
    assert.equal(one[0], "If a quote is still unanswered 1 hour and 30 minutes after you send it, one reminder is sent.");
    const custom = describeSchedule(
      record("quote_followup", { initialDelayMinutes: 2 * 1440, secondDelayMinutes: 10 * 1440, weekendSending: true }),
      translator("en"),
      "en",
    );
    assert.equal(custom[0], "If a quote is still unanswered, reminders are sent 2 days and 10 days after you send it.");
    assert.ok(custom[1]!.startsWith("Texts only go out between 8 AM and 8 PM. A text due"));
  });

  it("falls back to the scheduler's own second delay (two days after the first) when none is stored", () => {
    const config = { ...defaultConfig("quote_followup"), secondDelayMinutes: undefined };
    const lines = describeSchedule({ type: "quote_followup", config }, translator("en"), "en");
    assert.equal(lines[0], "If a quote is still unanswered, reminders are sent 1 day and 3 days after you send it.");
  });

  it("describes appointment reminders, and says nothing for the ones that are not available yet", () => {
    assert.equal(describeSchedule(record("appointment_reminder"), translator("en"), "en")[0], "A confirmation is sent when an appointment is booked. A reminder follows about 24 hours before the visit.");
    assert.deepEqual(describeSchedule(record("customer_reengagement"), translator("en"), "en"), []);
    assert.deepEqual(describeSchedule(record("urgent_lead_notification"), translator("en"), "en"), []);
  });
});

describe("durations and hours are written the way each language writes them", () => {
  it("splits minutes into days, hours and minutes", () => {
    assert.deepEqual(splitMinutes(1440), { days: 1, hours: 0, minutes: 0 });
    assert.deepEqual(splitMinutes(1500), { days: 1, hours: 1, minutes: 0 });
    assert.deepEqual(splitMinutes(7231), { days: 5, hours: 0, minutes: 31 });
    assert.deepEqual(splitMinutes(-5), { days: 0, hours: 0, minutes: 0 });
    assert.deepEqual(splitMinutes(Number.NaN), { days: 0, hours: 0, minutes: 0 });
  });

  it("writes durations", () => {
    const en = translator("en");
    const fr = translator("fr");
    assert.equal(formatDuration(1, en), "1 minute");
    assert.equal(formatDuration(2, en), "2 minutes");
    assert.equal(formatDuration(60, en), "1 hour");
    assert.equal(formatDuration(1440, en), "1 day");
    assert.equal(formatDuration(1500, en), "1 day and 1 hour");
    assert.equal(formatDuration(1501, en), "1 day, 1 hour and 1 minute");
    assert.equal(formatDuration(7200, fr), "5 jours");
    assert.equal(formatDuration(90, fr), "1 heure et 30 minutes");
    assert.equal(formatDuration(1, fr), "1 minute");
  });

  it("never leaves a doubled full stop after a time, in any sentence that ends with one", () => {
    for (const locale of ["en", "fr"] as const) {
      const t = translator(locale);
      for (let hour = 0; hour <= 24; hour++) {
        const time = formatHour(hour, locale, t);
        const sentences = [
          t("fields.hourHint", { time }),
          t("when.hoursWait", { start: time, end: time, weekends: "yes" }),
          t("when.hoursWait", { start: time, end: time, weekends: "no" }),
          t("when.quietOn", { start: time, end: time, weekends: "yes" }),
          t("when.quietOn", { start: time, end: time, weekends: "no" }),
        ];
        for (const sentence of sentences) assert.ok(!sentence.includes(".."), `${locale} ${hour}: "${sentence}"`);
      }
    }
  });

  it("writes hours of the day", () => {
    const en = translator("en");
    const fr = translator("fr");
    assert.deepEqual([0, 1, 8, 12, 13, 20, 24].map((h) => formatHour(h, "en", en)), ["midnight", "1 AM", "8 AM", "noon", "1 PM", "8 PM", "midnight"]);
    assert.deepEqual([0, 8, 12, 20, 24].map((h) => formatHour(h, "fr", fr)), ["minuit", "8 h", "midi", "20 h", "minuit"]);
    assert.equal(formatHour(99, "en", en), "midnight");
  });
});
