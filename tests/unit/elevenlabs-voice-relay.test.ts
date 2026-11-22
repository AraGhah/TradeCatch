/**
 * Live calls spoken by ElevenLabs through Twilio ConversationRelay: the TwiML
 * the incoming webhook renders, the signed turn route the Durable Object
 * calls, the socket bridge itself, and the fallback to <Gather> when the
 * relay breaks.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST as step } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import { POST as turnRoute } from "../../src/app/api/voice/relay/turn/route";
import { POST as relayEnded } from "../../src/app/api/webhooks/twilio/relay-ended/route";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";
import {
  normalizeRelayVoice,
  relayModeFromEnv,
  renderConversationRelayTwiml,
  usesConversationRelay,
} from "../../src/product/telephony/conversation-relay";
import {
  RELAY_TURN_HEADER,
  relaySocketUrlCandidates,
  signRelayTurn,
  validateTwilioSocketSignature,
  verifyRelayTurn,
} from "../../src/product/telephony/relay-auth";
import { estimateSpeechMs, planToRelay, type RelayTurn } from "../../src/product/telephony/relay-plan";
import { routeRelayUpgrade, VoiceRelaySession } from "../../src/product/telephony/relay-session";

const KEYS = [
  "NODE_ENV",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_LLM_PROVIDER",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_SMS_MODE",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "DATABASE_URL",
  "CONVERSATION_RELAY_MODE",
  "ELEVENLABS_RELAY_VOICE_FR",
  "ELEVENLABS_RELAY_VOICE_EN",
] as const;
const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

const TOKEN = "tok";
const LINE = "+14385597001";
const CALLER = "+15145559876";
const SID = "CA0123456789abcdef0123456789abcdef";
const BASE = "https://tradecatch.test";
const FR_VOICE = "AbCdEfGhIjKlMnOpQrSt";
const EN_VOICE = "ZyXwVuTsRqPoNmLkJiHg";

function twilioSigned(path: string, params: Record<string, string>) {
  const url = `${BASE}${path}`;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createHmac("sha1", TOKEN).update(Buffer.from(data, "utf8")).digest("base64"),
    },
    body: new URLSearchParams(params).toString(),
  });
}

function incoming() {
  return step(
    twilioSigned("/api/twilio/voice/receptionist/incoming", { CallSid: SID, From: CALLER, To: LINE }),
    { params: Promise.resolve({ step: "incoming" }) },
  );
}

async function signedTurn(body: Record<string, unknown>, token = TOKEN) {
  const raw = JSON.stringify(body);
  return turnRoute(
    new NextRequest(`${BASE}/api/voice/relay/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", [RELAY_TURN_HEADER]: await signRelayTurn(token, raw) },
      body: raw,
    }),
  );
}

function setConfig(voiceEngine: string) {
  env.RECEPTIONIST_CONFIG_JSON = JSON.stringify({
    id: "rc_relay",
    clientAccountId: "client_relay",
    phoneNumberE164: LINE,
    businessName: "Nord Plomberie",
    voiceEngine,
    notifications: [{ type: "email", to: "owner@example.test" }],
  });
  resetReceptionistRuntimeForTests();
}

async function sessionId(): Promise<string> {
  const session = await getReceptionistRuntime().store.getSessionByCallSid(SID);
  assert.ok(session, "incoming created a session");
  return session.id;
}

beforeEach(() => {
  for (const k of KEYS) delete env[k];
  env.NODE_ENV = "test";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  env.MISSED_CALL_SMS_MODE = "dry-run";
  env.TWILIO_AUTH_TOKEN = TOKEN;
  env.TWILIO_ACCOUNT_SID = "ACtest";
  env.MISSED_CALL_PUBLIC_WEBHOOK_BASE = BASE;
  env.ELEVENLABS_RELAY_VOICE_FR = FR_VOICE;
  env.ELEVENLABS_RELAY_VOICE_EN = EN_VOICE;
  setConfig("conversation_relay");
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  resetReceptionistRuntimeForTests();
  for (const [k, v] of saved) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

describe("relay mode and voices", () => {
  it("is off unless CONVERSATION_RELAY_MODE says otherwise", () => {
    assert.equal(relayModeFromEnv({}), "off");
    assert.equal(relayModeFromEnv({ CONVERSATION_RELAY_MODE: "yes" }), "off");
    assert.equal(relayModeFromEnv({ CONVERSATION_RELAY_MODE: " ALL " }), "all");
    assert.equal(usesConversationRelay("conversation_relay", "off"), false);
    assert.equal(usesConversationRelay("conversation_relay", "opt_in"), true);
    assert.equal(usesConversationRelay("gather", "opt_in"), false);
    assert.equal(usesConversationRelay("gather", "all"), true);
    assert.equal(usesConversationRelay(undefined, "all"), true);
    assert.equal(usesConversationRelay("livekit", "all"), false);
  });

  it("adds the v4 model to a bare voice id and refuses anything malformed", () => {
    assert.equal(normalizeRelayVoice(FR_VOICE), `${FR_VOICE}-v4`);
    assert.equal(normalizeRelayVoice(`${FR_VOICE}-v4-0.35_0.8`), `${FR_VOICE}-v4-0.35_0.8`);
    assert.equal(normalizeRelayVoice(` ${FR_VOICE} `), `${FR_VOICE}-v4`);
    assert.equal(normalizeRelayVoice(undefined), null);
    assert.equal(normalizeRelayVoice("short"), null);
    assert.equal(normalizeRelayVoice(`${FR_VOICE}" onload="x`), null);
  });

  it("renders one ElevenLabs voice per language, keypad input and the opening prompts", () => {
    const xml = renderConversationRelayTwiml({
      websocketUrl: "wss://staging.example/api/voice/socket?session=rcs_1",
      language: "fr",
      actionUrl: "https://staging.example/api/webhooks/twilio/relay-ended",
      sessionId: "rcs_1",
      voices: { fr: `${FR_VOICE}-v4`, en: null },
      intro: { tokens: [{ text: `Bonjour, "Nord" & cie`, lang: "fr-CA" }], listenSeconds: 6, end: null },
    });
    assert.match(xml, /url="wss:\/\/staging\.example\/api\/voice\/socket\?session=rcs_1"/);
    assert.match(xml, /ttsProvider="ElevenLabs"/);
    assert.match(xml, new RegExp(`<Language code="fr-CA" ttsProvider="ElevenLabs" voice="${FR_VOICE}-v4"/>`));
    assert.match(xml, /<Language code="en-US" ttsProvider="ElevenLabs"\/>/);
    assert.match(xml, /dtmfDetection="true"/);
    assert.match(xml, /<Parameter name="intro" value="\{&quot;tokens&quot;/);
    assert.doesNotMatch(xml, /"Nord"/, "intro text is escaped inside the attribute");
  });
});

describe("plan → relay turn", () => {
  it("speaks prompts then listens", () => {
    const turn = planToRelay({
      sessionId: "rcs_1",
      verbs: [
        { verb: "say", text: "Bonjour.", language: "fr", voice: "x" },
        {
          verb: "gather",
          next: "gather",
          language: "fr",
          prompts: [
            { text: "Pour le français, restez en ligne.", voice: "x", language: "fr" },
            { text: "For English, press 9.", voice: "y", language: "en" },
          ],
          input: ["speech", "dtmf"],
          timeoutSeconds: 5,
        },
      ],
    });
    assert.deepEqual(turn.tokens.map((t) => t.lang), ["fr-CA", "fr-CA", "en-US"]);
    assert.equal(turn.listenSeconds, 5);
    assert.equal(turn.language, "fr-CA");
    assert.equal(turn.end, null);
  });

  it("ends with the transfer, voicemail or hang-up the plan asks for", () => {
    const dial = planToRelay({
      sessionId: "rcs_1",
      verbs: [
        { verb: "say", text: "Je vous transfère.", language: "fr", voice: "x" },
        { verb: "dial", next: "dial", phoneE164: "+15145550100", timeoutSeconds: 20, screen: true },
      ],
    });
    assert.deepEqual(dial.end, {
      action: "dial",
      sessionId: "rcs_1",
      phoneE164: "+15145550100",
      timeoutSeconds: 20,
      screen: true,
    });
    const voicemail = planToRelay({
      sessionId: "rcs_1",
      verbs: [{ verb: "record", next: "voicemail", maxLengthSeconds: 90 }],
    });
    assert.deepEqual(voicemail.end, { action: "voicemail", sessionId: "rcs_1", maxLengthSeconds: 90 });
    assert.deepEqual(planToRelay({ sessionId: "rcs_1", verbs: [{ verb: "hangup" }] }).end, { action: "hangup" });
    // Speaking with nothing after it would leave the caller in silence.
    const dangling = planToRelay({
      sessionId: "rcs_1",
      verbs: [{ verb: "say", text: "Merci.", language: "fr", voice: "x" }],
    });
    assert.deepEqual(dangling.end, { action: "hangup" });
  });

  it("estimates how long the tokens take to say", () => {
    assert.equal(estimateSpeechMs([]), 0);
    const short = estimateSpeechMs([{ text: "Bonjour.", lang: "fr-CA" }]);
    assert.ok(short > 800 && short < 2_000, String(short));
    assert.equal(estimateSpeechMs([{ text: "x".repeat(10_000), lang: "fr-CA" }]), 30_000);
  });
});

describe("relay authentication", () => {
  const socketUrl = `${BASE.replace("https", "wss")}/api/voice/socket?session=rcs_1`;
  const twilioSignature = (url: string) => createHmac("sha1", TOKEN).update(url).digest("base64");

  it("accepts Twilio's signature over the wss:// URL it was given, and nothing else", async () => {
    const urls = relaySocketUrlCandidates("https://worker.internal/api/voice/socket?session=rcs_1", BASE);
    assert.ok(urls.includes(socketUrl));
    assert.equal(await validateTwilioSocketSignature({ authToken: TOKEN, signature: twilioSignature(socketUrl), urls }), true);
    const other = `${BASE.replace("https", "wss")}/api/voice/socket?session=rcs_2`;
    assert.equal(await validateTwilioSocketSignature({ authToken: TOKEN, signature: twilioSignature(other), urls }), false);
    assert.equal(await validateTwilioSocketSignature({ authToken: "wrong", signature: twilioSignature(socketUrl), urls }), false);
    assert.equal(await validateTwilioSocketSignature({ authToken: TOKEN, signature: "", urls }), false);
  });

  it("binds a turn signature to its body, its key and a recent time", async () => {
    const now = 1_800_000_000_000;
    const header = await signRelayTurn(TOKEN, '{"a":1}', now);
    assert.equal(await verifyRelayTurn({ authToken: TOKEN, header, body: '{"a":1}', now }), true);
    assert.equal(await verifyRelayTurn({ authToken: TOKEN, header, body: '{"a":2}', now }), false);
    assert.equal(await verifyRelayTurn({ authToken: "other", header, body: '{"a":1}', now }), false);
    assert.equal(await verifyRelayTurn({ authToken: TOKEN, header, body: '{"a":1}', now: now + 120_000 }), false);
    assert.equal(await verifyRelayTurn({ authToken: undefined, header, body: '{"a":1}', now }), false);
    assert.equal(await verifyRelayTurn({ authToken: TOKEN, header: null, body: '{"a":1}', now }), false);
  });
});

describe("incoming call with ElevenLabs relay", () => {
  it("keeps the classic <Gather> voice while CONVERSATION_RELAY_MODE is off", async () => {
    const res = await incoming();
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.doesNotMatch(xml, /ConversationRelay/);
    assert.match(xml, /<Gather/);
  });

  it("connects the call to the relay socket with ElevenLabs voices when enabled", async () => {
    env.CONVERSATION_RELAY_MODE = "opt_in";
    const xml = await (await incoming()).text();
    const id = await sessionId();
    assert.match(xml, /<Connect action="https:\/\/tradecatch\.test\/api\/webhooks\/twilio\/relay-ended"/);
    assert.ok(xml.includes(`url="wss://tradecatch.test/api/voice/socket?session=${id}"`), xml);
    assert.ok(xml.includes(`voice="${FR_VOICE}-v4"`) && xml.includes(`voice="${EN_VOICE}-v4"`), xml);
    assert.match(xml, /<Parameter name="intro"/);
    assert.doesNotMatch(xml, /<Gather/);
  });

  it("leaves a gather business alone in opt_in mode", async () => {
    env.CONVERSATION_RELAY_MODE = "opt_in";
    setConfig("gather");
    assert.doesNotMatch(await (await incoming()).text(), /ConversationRelay/);
  });
});

describe("relay turn route", () => {
  beforeEach(() => {
    env.CONVERSATION_RELAY_MODE = "opt_in";
  });

  it("refuses an unsigned or wrongly signed turn before touching the call", async () => {
    await incoming();
    const id = await sessionId();
    const body = JSON.stringify({ sessionId: id, callSid: SID, kind: "prompt", speech: "fuite d'eau" });
    const unsigned = await turnRoute(
      new NextRequest(`${BASE}/api/voice/relay/turn`, { method: "POST", body }),
    );
    assert.equal(unsigned.status, 403);
    const forged = await signedTurn({ sessionId: id, callSid: SID, kind: "prompt", speech: "x" }, "not-the-token");
    assert.equal(forged.status, 403);
  });

  it("refuses a session that belongs to another call", async () => {
    await incoming();
    const id = await sessionId();
    const res = await signedTurn({ sessionId: id, callSid: "CAother", kind: "prompt", speech: "allô" });
    assert.equal(res.status, 404);
    assert.equal((await signedTurn({ sessionId: id, callSid: SID, kind: "shout" })).status, 400);
  });

  it("answers a caller turn with the engine's reply as relay tokens", async () => {
    await incoming();
    const id = await sessionId();
    const res = await signedTurn({ sessionId: id, callSid: SID, kind: "prompt", speech: "J'ai une fuite d'eau dans la cuisine" });
    assert.equal(res.status, 200);
    const turn = (await res.json()) as RelayTurn;
    assert.ok(turn.tokens.length > 0, "the receptionist says something back");
    assert.ok(turn.tokens.every((t) => t.lang === "fr-CA" || t.lang === "en-US"));
    assert.ok(turn.listenSeconds !== null || turn.end !== null);
    const session = await getReceptionistRuntime().store.getSession(id);
    assert.ok(session?.turns.some((t) => t.text.includes("fuite d'eau")), "the turn is on the call record");
  });
});

describe("relay-ended callback", () => {
  beforeEach(() => {
    env.CONVERSATION_RELAY_MODE = "opt_in";
  });

  it("keeps the caller on the classic voice when the relay fails", async () => {
    await incoming();
    const res = await relayEnded(
      twilioSigned("/api/webhooks/twilio/relay-ended", {
        CallSid: SID,
        CallStatus: "in-progress",
        SessionStatus: "failed",
        ErrorCode: "64101",
      }),
    );
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /<Gather/);
    assert.doesNotMatch(xml, /<Hangup\/>/);
  });

  it("records a voicemail the relay handed off", async () => {
    await incoming();
    const id = await sessionId();
    const xml = await (
      await relayEnded(
        twilioSigned("/api/webhooks/twilio/relay-ended", {
          CallSid: SID,
          CallStatus: "in-progress",
          SessionStatus: "ended",
          HandoffData: JSON.stringify({ action: "voicemail", sessionId: id, maxLengthSeconds: 90 }),
        }),
      )
    ).text();
    assert.match(xml, /<Record[^>]*maxLength="90"/);
  });

  it("hangs up once the caller has gone", async () => {
    await incoming();
    const xml = await (
      await relayEnded(
        twilioSigned("/api/webhooks/twilio/relay-ended", { CallSid: SID, CallStatus: "completed", SessionStatus: "completed" }),
      )
    ).text();
    assert.match(xml, /<Hangup\/>/);
  });
});

/* ------------------------------------------------------------------------- */
/* The Durable Object bridge, with an in-memory socket and storage.          */
/* ------------------------------------------------------------------------- */

class FakeSocket {
  sent: Record<string, unknown>[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private attachment: unknown = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

function harness(answer: (body: Record<string, unknown>) => RelayTurn | Response) {
  const socket = new FakeSocket();
  socket.serializeAttachment({ sessionId: "rcs_1", callSid: null });
  const store = new Map<string, unknown>();
  let alarmAt: number | null = null;
  const turns: Record<string, unknown>[] = [];
  const ctx = {
    getWebSockets: () => [socket],
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
      delete: async (key: string) => store.delete(key),
      setAlarm: async (at: number) => void (alarmAt = at),
      deleteAlarm: async () => void (alarmAt = null),
    },
  };
  const selfFetch = async (url: string, init: RequestInit) => {
    const body = String(init.body);
    const headers = init.headers as Record<string, string>;
    assert.equal(new URL(url).pathname, "/api/voice/relay/turn");
    assert.equal(
      await verifyRelayTurn({ authToken: TOKEN, header: headers[RELAY_TURN_HEADER] ?? null, body }),
      true,
      "every turn the bridge forwards is signed",
    );
    const parsed = JSON.parse(body) as Record<string, unknown>;
    turns.push(parsed);
    const reply = answer(parsed);
    return reply instanceof Response ? reply : Response.json(reply);
  };
  const relay = new VoiceRelaySession(ctx as unknown as DurableObjectState, {
    TWILIO_AUTH_TOKEN: TOKEN,
    MISSED_CALL_PUBLIC_WEBHOOK_BASE: BASE,
    WORKER_SELF_REFERENCE: { fetch: selfFetch } as unknown as Fetcher,
  });
  const message = (msg: Record<string, unknown>) =>
    relay.webSocketMessage(socket as unknown as WebSocket, JSON.stringify(msg));
  const setup = (intro?: RelayTurn) =>
    message({
      type: "setup",
      callSid: SID,
      customParameters: { sessionId: "rcs_1", ...(intro ? { intro: JSON.stringify(intro) } : {}) },
    });
  return { socket, relay, store, turns, message, setup, alarm: () => alarmAt };
}

const listening = (text: string): RelayTurn => ({
  tokens: [{ text, lang: "fr-CA" }],
  listenSeconds: 5,
  end: null,
});

describe("VoiceRelaySession bridge", () => {
  it("refuses a socket whose setup names another session", async () => {
    const h = harness(() => listening("x"));
    await h.message({ type: "setup", callSid: SID, customParameters: { sessionId: "rcs_other" } });
    assert.equal(h.socket.closed?.code, 1008);
    assert.deepEqual(h.turns, []);
  });

  it("speaks the opening prompts on setup, then waits for the caller", async () => {
    const h = harness(() => listening("x"));
    const before = Date.now();
    await h.setup(listening("Bonjour, Nord Plomberie."));
    assert.deepEqual(h.socket.sent, [{ type: "text", token: "Bonjour, Nord Plomberie.", lang: "fr-CA", last: true }]);
    assert.deepEqual(h.store.get("pending"), { kind: "silence" });
    assert.ok((h.alarm() ?? 0) >= before + 5_000, "silence timer covers speaking + listening");
    assert.deepEqual(h.turns, [], "no engine call before the caller speaks");
  });

  it("forwards what the caller said and speaks the reply", async () => {
    const h = harness((body) => listening(`Vous avez dit : ${String(body.speech)}`));
    await h.setup();
    await h.message({ type: "prompt", voicePrompt: "une fuite", last: true });
    assert.deepEqual(h.turns, [{ kind: "prompt", speech: "une fuite", sessionId: "rcs_1", callSid: SID }]);
    assert.equal(h.socket.sent.at(-1)?.token, "Vous avez dit : une fuite");
    await h.message({ type: "dtmf", digit: "9" });
    assert.deepEqual(h.turns.at(-1), { kind: "dtmf", digits: "9", sessionId: "rcs_1", callSid: SID });
  });

  it("switches Twilio's transcription when the caller moves to English", async () => {
    const h = harness(() => ({ ...listening("How can I help?"), language: "en-US" }));
    await h.setup({ ...listening("Bonjour."), language: "fr-CA" });
    assert.equal(h.socket.sent.some((m) => m.type === "language"), false, "the TwiML set French already");
    await h.message({ type: "dtmf", digit: "9" });
    const switchAt = h.socket.sent.findIndex((m) => m.type === "language");
    assert.deepEqual(h.socket.sent[switchAt], {
      type: "language",
      ttsLanguage: "en-US",
      transcriptionLanguage: "en-US",
    });
    assert.equal(h.socket.sent[switchAt + 1]?.token, "How can I help?");
    await h.message({ type: "prompt", voicePrompt: "a leak", last: true });
    assert.equal(h.socket.sent.filter((m) => m.type === "language").length, 1, "sent once per change");
  });

  it("lets the goodbye finish before ending, and ignores speech meanwhile", async () => {
    const h = harness(() => ({ tokens: [{ text: "Merci, au revoir.", lang: "fr-CA" }], listenSeconds: null, end: { action: "hangup" } }));
    await h.setup();
    await h.message({ type: "prompt", voicePrompt: "c'est tout", last: true });
    assert.equal(h.socket.sent.some((m) => m.type === "end"), false, "not cut off mid-sentence");
    assert.ok(h.alarm());
    await h.message({ type: "prompt", voicePrompt: "attendez", last: true });
    assert.equal(h.turns.length, 1);
    await h.relay.alarm();
    assert.deepEqual(h.socket.sent.at(-1), { type: "end", handoffData: JSON.stringify({ action: "hangup" }) });
  });

  it("runs the engine's no-input turn when the caller stays silent", async () => {
    const h = harness(() => listening("Êtes-vous toujours là ?"));
    await h.setup(listening("Bonjour."));
    await h.relay.alarm();
    assert.deepEqual(h.turns, [{ kind: "silence", sessionId: "rcs_1", callSid: SID }]);
    assert.equal(h.socket.sent.at(-1)?.token, "Êtes-vous toujours là ?");
  });

  it("hands the call back to <Gather> when a turn fails", async () => {
    const h = harness(() => new Response("boom", { status: 500 }));
    await h.setup();
    await h.message({ type: "prompt", voicePrompt: "allô", last: true });
    assert.deepEqual(h.socket.sent.at(-1), {
      type: "end",
      handoffData: JSON.stringify({ action: "fallback", sessionId: "rcs_1" }),
    });
  });
});

describe("Worker upgrade routing", () => {
  const upgrade = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://worker.internal${path}`, { headers: { upgrade: "websocket", ...headers } });
  const path = "/api/voice/socket?session=rcs_1";
  const signature = createHmac("sha1", TOKEN).update(`wss://tradecatch.test${path}`).digest("base64");

  function namespace() {
    const forwarded: Request[] = [];
    return {
      forwarded,
      ns: {
        idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
        get: () => ({ fetch: async (req: Request) => (forwarded.push(req), new Response("ok")) }),
      },
    };
  }

  it("leaves every other request to Next", async () => {
    const { ns } = namespace();
    const relayEnv = { VOICE_RELAY: ns, TWILIO_AUTH_TOKEN: TOKEN, MISSED_CALL_PUBLIC_WEBHOOK_BASE: BASE };
    assert.equal(await routeRelayUpgrade(new Request(`https://worker.internal${path}`), relayEnv), null);
    assert.equal(await routeRelayUpgrade(upgrade("/api/other"), relayEnv), null);
  });

  it("only hands a Twilio-signed upgrade to the call's Durable Object", async () => {
    const { ns, forwarded } = namespace();
    const relayEnv = { VOICE_RELAY: ns, TWILIO_AUTH_TOKEN: TOKEN, MISSED_CALL_PUBLIC_WEBHOOK_BASE: BASE };
    assert.equal((await routeRelayUpgrade(upgrade(path), relayEnv))?.status, 403);
    assert.equal((await routeRelayUpgrade(upgrade(path, { "x-twilio-signature": "bad" }), relayEnv))?.status, 403);
    assert.equal((await routeRelayUpgrade(upgrade("/api/voice/socket", { "x-twilio-signature": signature }), relayEnv))?.status, 403);
    assert.equal(forwarded.length, 0);
    const ok = await routeRelayUpgrade(upgrade(path, { "x-twilio-signature": signature }), relayEnv);
    assert.equal(ok?.status, 200);
    assert.equal(forwarded.length, 1);
  });

  it("is unavailable, never open, without the binding or the auth token", async () => {
    const { ns } = namespace();
    const headers = { "x-twilio-signature": signature };
    assert.equal((await routeRelayUpgrade(upgrade(path, headers), { TWILIO_AUTH_TOKEN: TOKEN }))?.status, 503);
    assert.equal((await routeRelayUpgrade(upgrade(path, headers), { VOICE_RELAY: ns }))?.status, 503);
  });
});
