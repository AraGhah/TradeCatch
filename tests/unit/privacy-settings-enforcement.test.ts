/**
 * Each privacy setting changes what TradeCatch actually does, not just a
 * stored flag: the call engine (recording, transcripts, retention), the config
 * loader that carries the stored settings to live calls, the retention job
 * (SMS history, retention), and the dashboard analytics gate.
 */
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import type { ReceptionistNotifier } from "../../src/product/receptionist/notifications";
import type { CallSession, ReceptionistConfig } from "../../src/product/receptionist/types";
import {
  applyPrivacySettings,
  loadProfileConfigs,
} from "../../src/product/receptionist/profile-loader";
import { profileSettingsSchema, type ReceptionistProfile } from "../../src/product/receptionist/profile";
import type { ProfileStore } from "../../src/product/receptionist/profile-store";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { defaultPrivacySettings } from "../../src/product/privacy/settings";
import { applyPrivacyRetention } from "../../src/product/privacy/retention";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const LINE = "+14385597101";

function lineConfig(over: Partial<ReceptionistConfig> = {}): ReceptionistConfig {
  return {
    ...parseReceptionistConfig({
      id: "rc_privacy",
      clientAccountId: "client_privacy",
      phoneNumberE164: LINE,
      businessName: "Plomberie Privée",
      languages: ["fr"],
      allowVoicemailOnly: true,
      notifications: [{ type: "email", to: "owner@example.test" }],
      smsRecoveryOnIncomplete: false,
    }),
    ...over,
  };
}

type TextBack = { clientAccountId: string; callerE164: string; callSid: string; at: Date };

function engineFor(
  config: ReceptionistConfig,
  opts: { textBack?: "wired" | "failing" | "absent" } = {},
) {
  const store = createMemoryReceptionistStore();
  const delivered: CallSession[] = [];
  const texts: TextBack[] = [];
  const mode = opts.textBack ?? "wired";
  const notifier = {
    async deliverSummary(_config: ReceptionistConfig, session: CallSession) {
      delivered.push(structuredClone(session));
      return [];
    },
    alertEmergency() {},
  } as unknown as ReceptionistNotifier;
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier,
    ...(mode === "absent"
      ? {}
      : {
          async onIncompleteCall(input: TextBack) {
            if (mode === "failing") throw new Error("sms down");
            texts.push(input);
          },
        }),
  });
  return { engine, store, delivered, texts };
}

async function finishedCall(config: ReceptionistConfig, sid: string) {
  const h = engineFor(config);
  const started = await h.engine.startCall({ callSid: sid, fromE164: "+15145559876", toE164: LINE });
  assert.ok(started.sessionId);
  await h.engine.handleGather({ sessionId: started.sessionId, speech: "J'ai une fuite sous l'évier, rappelez-moi au 514 555 9876" });
  const ended = await h.engine.handleCallStatus({ callSid: sid, callStatus: "completed", durationSeconds: 40 });
  assert.equal(ended.finalized, true);
  const stored = await h.store.getSession(started.sessionId);
  assert.ok(stored);
  return { ...h, stored };
}

describe("callRecordingEnabled", () => {
  it("ON: the caller hears the recording notice, then a voicemail is recorded", () => {
    const { engine } = engineFor(lineConfig({ callRecordingEnabled: true }));
    const plan = engine.failSafePlan(lineConfig({ callRecordingEnabled: true }), "sess_1");
    const say = plan.verbs.find((v) => v.verb === "say" && "text" in v && /sera enregistré/.test(v.text));
    assert.ok(say, "no recording notice before the beep");
    const sayIndex = plan.verbs.indexOf(say!);
    const recordIndex = plan.verbs.findIndex((v) => v.verb === "record");
    assert.ok(recordIndex > sayIndex);
  });

  it("OFF: nothing is recorded; the caller is told a text is coming, never to call back, and the call ends", () => {
    const config = lineConfig({ callRecordingEnabled: false, smsRecoveryOnIncomplete: true });
    const { engine } = engineFor(config);
    for (const lang of ["fr", "en"] as const) {
      const plan = engine.failSafePlan(config, "sess_1", lang);
      const spoken = JSON.stringify(plan.verbs);
      assert.equal(plan.verbs.some((v) => v.verb === "record"), false);
      assert.equal(plan.verbs.at(-1)?.verb, "hangup");
      assert.match(spoken, lang === "fr" ? /message texte/ : /text message/);
      assert.doesNotMatch(spoken, /rappeler|call back|plus tard|later/i);
    }
  });

  it("OFF: when no text can be sent the caller is told the team will see the call, never to call back", () => {
    const noTexts = lineConfig({ callRecordingEnabled: false, smsRecoveryOnIncomplete: false });
    const wired = lineConfig({ callRecordingEnabled: false, smsRecoveryOnIncomplete: true });
    const cases = [
      { label: "business has texting off", config: noTexts, engine: engineFor(noTexts).engine, canText: true },
      { label: "no sender wired", config: wired, engine: engineFor(wired, { textBack: "absent" }).engine, canText: true },
      { label: "caller number unknown", config: wired, engine: engineFor(wired).engine, canText: false },
    ];
    for (const { label, config, engine, canText } of cases) {
      for (const lang of ["fr", "en"] as const) {
        const plan = engine.failSafePlan(config, "sess_1", lang, { canText });
        const spoken = JSON.stringify(plan.verbs);
        assert.equal(plan.verbs.some((v) => v.verb === "record"), false, label);
        assert.equal(plan.verbs.at(-1)?.verb, "hangup", label);
        assert.match(spoken, lang === "fr" ? /notre équipe verra votre appel/ : /our team will see your call/, label);
        assert.doesNotMatch(spoken, /rappeler|call back|plus tard|later|texte|text message/i, label);
      }
    }
  });

  it("OFF: the text goes out right away, once, to the caller, tied to the call id", async () => {
    const config = lineConfig({ callRecordingEnabled: false, smsRecoveryOnIncomplete: true });
    const { engine, texts } = engineFor(config);
    assert.equal(engine.failSafePromisesText(config), true);
    const sent = await engine.sendFailSafeTextBack(config, { callerE164: "+15145559876", callSid: "CAfail1" });
    assert.equal(sent, true);
    assert.equal(texts.length, 1);
    assert.deepEqual(
      [texts[0]!.clientAccountId, texts[0]!.callerE164, texts[0]!.callSid],
      [config.clientAccountId, "+15145559876", "CAfail1"],
    );
  });

  it("no text is sent, and none is promised, when recording is on, a fallback line rings, or texting is off", async () => {
    const cases: Partial<ReceptionistConfig>[] = [
      { callRecordingEnabled: true, smsRecoveryOnIncomplete: true },
      { callRecordingEnabled: false, smsRecoveryOnIncomplete: true, fallbackTransferE164: "+14385597109" },
      { callRecordingEnabled: false, smsRecoveryOnIncomplete: false },
    ];
    for (const over of cases) {
      const config = lineConfig(over);
      const { engine, texts } = engineFor(config);
      assert.equal(engine.failSafePromisesText(config), false, JSON.stringify(over));
      assert.equal(await engine.sendFailSafeTextBack(config, { callerE164: "+15145559876", callSid: "CAno" }), false);
      assert.equal(texts.length, 0, JSON.stringify(over));
    }
    assert.equal(engineFor(lineConfig()).engine.failSafePromisesText(null), false);
  });

  it("a failing text sender never fails the call", async () => {
    const config = lineConfig({ callRecordingEnabled: false, smsRecoveryOnIncomplete: true });
    const { engine } = engineFor(config, { textBack: "failing" });
    const quiet = mock.method(console, "error", () => {});
    try {
      assert.equal(await engine.sendFailSafeTextBack(config, { callerE164: "+15145559876", callSid: "CAfail2" }), false);
    } finally {
      quiet.mock.restore();
    }
  });

  it("a missing number or call id sends nothing", async () => {
    const config = lineConfig({ callRecordingEnabled: false, smsRecoveryOnIncomplete: true });
    const { engine, texts } = engineFor(config);
    assert.equal(await engine.sendFailSafeTextBack(config, { callerE164: "", callSid: "CAx" }), false);
    assert.equal(await engine.sendFailSafeTextBack(config, { callerE164: "+15145559876", callSid: "" }), false);
    assert.equal(texts.length, 0);
  });

  it("OFF does not stop a live person taking the call when a fallback line exists", () => {
    const config = lineConfig({ callRecordingEnabled: false, fallbackTransferE164: "+14385597109" });
    const plan = engineFor(config).engine.failSafePlan(config, "sess_1");
    assert.ok(plan.verbs.some((v) => v.verb === "dial"));
  });
});

describe("saveCallTranscripts", () => {
  it("ON: the transcript is kept with the call", async () => {
    const { stored, delivered } = await finishedCall(lineConfig({ saveCallTranscripts: true }), "CAkeep");
    assert.ok(stored.turns.some((t) => t.speaker === "caller"));
    assert.equal(stored.transcriptPurgedAt, undefined);
    assert.ok(delivered[0]!.turns.length > 0);
  });

  it("OFF: the summary is still built and sent, but no transcript is stored or sent", async () => {
    const { stored, delivered } = await finishedCall(lineConfig({ saveCallTranscripts: false }), "CAdrop");
    assert.deepEqual(stored.turns, []);
    assert.ok(stored.transcriptPurgedAt);
    assert.ok(stored.summary, "the owner's summary must still exist");
    assert.ok(stored.finalizedAt);
    assert.equal(delivered.length, 1, "the owner is still notified");
    assert.deepEqual(delivered[0]!.turns, [], "the transcript left TradeCatch in the notification");
  });
});

describe("customerDataRetentionDays (calls)", () => {
  it("the chosen period replaces the transcript retention and the tick clears older calls", async () => {
    const base = lineConfig({ transcriptRetentionDays: 365 });
    const config = applyPrivacySettings(base, { ...defaultPrivacySettings("org"), customerDataRetentionDays: 30 });
    assert.equal(config.transcriptRetentionDays, 30);
    const { stored, store, engine } = await finishedCall(config, "CAold");
    // Make the call 40 days old.
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await store.saveSession({ ...stored, startedAt: old, endedAt: old, finalizedAt: old });
    const result = await engine.tick();
    assert.ok(result.purged >= 1);
    const purged = await store.getSession(stored.id);
    assert.deepEqual(purged?.turns, []);
    assert.equal(purged?.recordingUrl, undefined);
    assert.ok(purged?.transcriptPurgedAt);
  });

  it("'standard' (businesses that predate the setting) keeps the profile's retention", () => {
    const base = lineConfig({ transcriptRetentionDays: 365 });
    const config = applyPrivacySettings(base, { ...defaultPrivacySettings("org"), customerDataRetentionDays: null });
    assert.equal(config.transcriptRetentionDays, 365);
  });
});

describe("profile loader carries each business's stored settings to its line", () => {
  const client = demoClientAccount({ id: "client_a" });
  const profile = (organizationId: string, phoneNumberE164: string): ReceptionistProfile => ({
    organizationId,
    phoneNumberE164,
    activated: true,
    settings: profileSettingsSchema.parse({
      notifyEmail: "owner@example.com",
      transferSettings: { failedAction: "voicemail" },
    }),
    updatedAt: new Date().toISOString(),
  });
  const deps = (getPrivacy: Parameters<typeof loadProfileConfigs>[0]["getPrivacy"]) => ({
    profiles: {
      listActivatedProfiles: async () => [profile("org_a", "+14385597201"), profile("org_b", "+14385597202")],
    } as unknown as ProfileStore,
    getOrganization: async (id: string) => ({ id, status: "active", plan: "professional" as const, missedCallClientId: "client_a" }),
    getClient: async () => client,
    env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
    getPrivacy,
  });

  it("business A's choices reach A's line only", async () => {
    const configs = await loadProfileConfigs(
      deps(async (ids) => {
        const map = new Map(ids.map((id) => [id, defaultPrivacySettings(id)]));
        map.set("org_a", { ...defaultPrivacySettings("org_a"), callRecordingEnabled: true, saveCallTranscripts: false, customerDataRetentionDays: 180 });
        return map;
      }),
    );
    const a = configs.find((c) => c.phoneNumberE164 === "+14385597201")!;
    const b = configs.find((c) => c.phoneNumberE164 === "+14385597202")!;
    assert.deepEqual([a.callRecordingEnabled, a.saveCallTranscripts, a.transcriptRetentionDays], [true, false, 180]);
    assert.deepEqual([b.callRecordingEnabled, b.saveCallTranscripts, b.transcriptRetentionDays], [false, true, 90]);
  });

  it("if the settings cannot be read, calls are still answered with nothing recorded or kept", async () => {
    let reported = false;
    const configs = await loadProfileConfigs({
      ...deps(async () => {
        throw new Error("db down");
      }),
      onPrivacyError: () => {
        reported = true;
      },
    });
    assert.equal(configs.length, 2);
    assert.ok(reported);
    for (const c of configs) {
      assert.equal(c.callRecordingEnabled, false);
      assert.equal(c.saveCallTranscripts, false);
    }
  });
});

describe("saveSmsHistory and customerDataRetentionDays (messages), real SQL on PGlite", { skip: !pgliteAvailable() }, () => {
  let db: PgliteDb;
  const NOW = new Date("2026-11-14T12:00:00.000Z");
  const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

  before(async () => {
    db = await createPglite();
    await db.exec(`
      CREATE TABLE tc_organizations (id TEXT PRIMARY KEY, missed_call_client_id TEXT);
      CREATE TABLE tc_privacy_settings (organization_id TEXT PRIMARY KEY, call_recording_enabled BOOLEAN NOT NULL,
        save_call_transcripts BOOLEAN NOT NULL, save_sms_history BOOLEAN NOT NULL, customer_data_retention_days INT,
        analytics_enabled BOOLEAN NOT NULL, version INT NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT);
      CREATE TABLE tc_crm_messages (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, body TEXT NOT NULL,
        delivery_status TEXT NOT NULL, at TIMESTAMPTZ NOT NULL);
      CREATE TABLE tc_quote_threads (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      CREATE TABLE tc_quote_messages (id SERIAL PRIMARY KEY, thread_id TEXT NOT NULL, body TEXT NOT NULL, at TIMESTAMPTZ NOT NULL);
      CREATE TABLE tc_sms_executions (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, message_body TEXT, at TIMESTAMPTZ NOT NULL);
      CREATE TABLE mc_outbound_messages (id TEXT PRIMARY KEY, client_account_id TEXT NOT NULL, to_e164 TEXT NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE tc_sms_suppressions (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, phone_e164 TEXT NOT NULL);

      -- sms_off: SMS history off, standard retention. keep: legacy business (on, standard).
      -- r30: history on, 30 days. fresh: created after 040, no row (defaults: on, 90 days).
      INSERT INTO tc_organizations VALUES ('sms_off','cl_off'), ('keep','cl_keep'), ('r30', NULL), ('fresh', NULL);
      INSERT INTO tc_privacy_settings (organization_id, call_recording_enabled, save_call_transcripts, save_sms_history, customer_data_retention_days, analytics_enabled)
        VALUES ('sms_off', false, true, false, NULL, false), ('keep', false, true, true, NULL, true), ('r30', false, true, true, 30, false);
      INSERT INTO tc_sms_suppressions VALUES ('sup1', 'sms_off', '+15145550001');
    `);
    const rows: [string, string, string, string, number][] = [
      ["off_old", "sms_off", "Bonjour, fuite au sous-sol", "delivered", 30],
      ["off_recent", "sms_off", "Toujours dispo demain?", "delivered", 2],
      ["off_queued", "sms_off", "En attente d'envoi", "queued", 30],
      ["keep_old", "keep", "Rendez-vous confirmé", "delivered", 24 * 400],
      ["r30_old", "r30", "Vieux message", "delivered", 24 * 31],
      ["r30_new", "r30", "Message récent", "delivered", 24 * 29],
      ["fresh_old", "fresh", "Très vieux", "delivered", 24 * 91],
      ["fresh_new", "fresh", "Pas si vieux", "delivered", 24 * 89],
    ];
    for (const [id, org, body, status, hours] of rows)
      await db.query(`INSERT INTO tc_crm_messages VALUES ($1,$2,$3,$4,$5)`, [id, org, body, status, ago(hours)]);
    await db.exec(`INSERT INTO tc_quote_threads VALUES ('t_off','sms_off'), ('t_keep','keep')`);
    await db.query(`INSERT INTO tc_quote_messages (thread_id, body, at) VALUES ('t_off','Votre soumission',$1), ('t_keep','Votre soumission',$1)`, [ago(48)]);
    await db.query(`INSERT INTO tc_sms_executions VALUES ('e_off','sms_off','Rappel',$1), ('e_keep','keep','Rappel',$1)`, [ago(48)]);
    await db.query(
      `INSERT INTO mc_outbound_messages (id, client_account_id, to_e164, body, status, created_at) VALUES
        ('o_sent','cl_off','+15145550001','Texte envoyé','delivered',$1),
        ('o_retry','cl_off','+15145550001','Texte à réessayer','retry',$1),
        ('o_keep','cl_keep','+15145550002','Texte gardé','delivered',$1)`,
      [ago(48)],
    );
  });

  after(async () => db?.close());

  it("clears only what each business chose, keeps delivery records, queued messages and opt-outs", async () => {
    const result = await applyPrivacyRetention(poolOf(db), NOW);
    const body = async (id: string) =>
      (await db.query(`SELECT body FROM tc_crm_messages WHERE id = $1`, [id])).rows[0]?.body;

    // SMS history off: wording older than 24 h is gone, the record stays.
    assert.equal(await body("off_old"), "");
    assert.equal(await body("off_recent"), "Toujours dispo demain?");
    assert.equal(await body("off_queued"), "En attente d'envoi", "a message not yet delivered must never be cleared");
    const row = (await db.query(`SELECT delivery_status FROM tc_crm_messages WHERE id = 'off_old'`)).rows[0];
    assert.equal(row?.delivery_status, "delivered");
    // A business that predates the setting: nothing changes.
    assert.equal(await body("keep_old"), "Rendez-vous confirmé");
    // 30-day retention.
    assert.equal(await body("r30_old"), "");
    assert.equal(await body("r30_new"), "Message récent");
    // Created after the setting existed, never saved: 90-day default.
    assert.equal(await body("fresh_old"), "");
    assert.equal(await body("fresh_new"), "Pas si vieux");

    const quotes = (await db.query(`SELECT thread_id, body FROM tc_quote_messages ORDER BY thread_id`)).rows;
    assert.equal(quotes.find((q) => q.thread_id === "t_off")?.body, "");
    assert.equal(quotes.find((q) => q.thread_id === "t_keep")?.body, "Votre soumission");
    const executions = new Map((await db.query(`SELECT id, message_body FROM tc_sms_executions`)).rows.map((r) => [r.id, r.message_body]));
    assert.equal(executions.get("e_off"), null);
    assert.equal(executions.get("e_keep"), "Rappel");
    const outbound = new Map((await db.query(`SELECT id, body, status, to_e164 FROM mc_outbound_messages`)).rows.map((r) => [r.id, r]));
    assert.equal(outbound.get("o_sent")?.body, "[redacted]");
    assert.equal(outbound.get("o_sent")?.status, "delivered");
    assert.equal(outbound.get("o_sent")?.to_e164, "+15145550001");
    assert.equal(outbound.get("o_retry")?.body, "Texte à réessayer", "a message still being retried must be sent as written");
    assert.equal(outbound.get("o_keep")?.body, "Texte gardé");
    const optOuts = await db.query(`SELECT count(*)::int AS n FROM tc_sms_suppressions`);
    assert.equal(optOuts.rows[0]?.n, 1);

    assert.deepEqual(result, {
      crmMessagesCleared: 3,
      quoteMessagesCleared: 1,
      automationLogsCleared: 1,
      outboundMessagesCleared: 1,
    });
    // Running again changes nothing more.
    assert.deepEqual(await applyPrivacyRetention(poolOf(db), NOW), {
      crmMessagesCleared: 0,
      quoteMessagesCleared: 0,
      automationLogsCleared: 0,
      outboundMessagesCleared: 0,
    });
  });
});

describe("analyticsEnabled (dashboard)", () => {
  const consent = JSON.stringify({
    version: 1,
    analytics: true,
    wording: "x",
    decidedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  let path = "/";
  const g = globalThis as unknown as { window?: unknown };

  before(() => {
    const storage = new Map([["tradecatch-cookie-consent", consent]]);
    g.window = {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      },
      get location() {
        return { pathname: path, href: `https://tradecatch.test${path}` };
      },
      dispatchEvent: () => true,
    };
  });
  after(() => {
    delete g.window;
  });

  it("dashboard pages are measured only when the business allows it; marketing pages follow cookie consent", async () => {
    const { analyticsAllowed, setBusinessAnalytics, isDashboardPath } = await import("../../src/lib/analytics");
    assert.equal(isDashboardPath("/app"), true);
    assert.equal(isDashboardPath("/fr/app/receptionniste/confidentialite"), true);
    assert.equal(isDashboardPath("/apply"), false);
    assert.equal(analyticsAllowed("/pricing"), true);
    // Unknown (before the dashboard says) counts as no.
    assert.equal(analyticsAllowed("/app/calls"), false);
    setBusinessAnalytics(true);
    assert.equal(analyticsAllowed("/app/calls"), true);
    setBusinessAnalytics(false);
    assert.equal(analyticsAllowed("/app/calls"), false);
    assert.equal(analyticsAllowed("/fr/app"), false);
    path = "/app/calls";
    assert.equal(analyticsAllowed(), false);
  });
});
