import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET as agentConfigRoute } from "../../src/app/api/receptionist/agent-config/route";
import { buildAgentConfig } from "../../src/product/receptionist/agent-config";
import {
  organizationIdFromConfigId,
  resolveAgentVoice,
} from "../../src/product/receptionist/custom-voice/agent-voice";
import { resetReceptionistRuntimeForTests } from "../../src/product/receptionist/runtime";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  buildProfileConfig,
  profileSettingsSchema,
} from "../../src/product/receptionist/profile";
import { checkSample, sniffSample } from "../../src/product/receptionist/custom-voice/audio";
import {
  issueChallenge,
  normalizeSpeech,
  transcriptHasChallenge,
  verifyChallengeToken,
  wordCount,
} from "../../src/product/receptionist/custom-voice/challenge";
import {
  ProviderError,
  createElevenLabsClient,
  type VoiceProvider,
} from "../../src/product/receptionist/custom-voice/elevenlabs";
import {
  CONSENT_STATEMENT_VERSION,
  MIN_SAMPLE_BYTES,
  emptyVoiceRecord,
} from "../../src/product/receptionist/custom-voice/model";
import { createPostgresVoiceStore } from "../../src/product/receptionist/custom-voice/postgres-store";
import {
  createVoiceService,
  type VoiceActor,
} from "../../src/product/receptionist/custom-voice/service";
import { createMemoryVoiceStore } from "../../src/product/receptionist/custom-voice/store";
import { orgHasFeature } from "../../src/product/saas/entitlements";

const SECRET = "test-secret-test-secret-test-secret";
const NOW = new Date("2026-11-01T12:00:00.000Z");

/** A buffer that passes `checkSample` as WebM. */
function webmSample(size = MIN_SAMPLE_BYTES + 100): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  return bytes;
}

describe("plan entitlement", () => {
  it("custom voice is Receptionist Plus only", () => {
    assert.equal(orgHasFeature("receptionist", "AI_CUSTOM_VOICE"), true);
    assert.equal(orgHasFeature("growth", "AI_CUSTOM_VOICE"), false);
    assert.equal(orgHasFeature("starter", "AI_CUSTOM_VOICE"), false);
  });
});

describe("audio sample checks", () => {
  it("identifies containers by content, not by the claimed name", () => {
    assert.equal(sniffSample(webmSample()), "webm");
    const wav = new Uint8Array(40);
    wav.set([...Buffer.from("RIFF")], 0);
    wav.set([...Buffer.from("WAVE")], 8);
    assert.equal(sniffSample(wav), "wav");
    const mp3 = new Uint8Array(40);
    mp3.set([...Buffer.from("ID3")], 0);
    assert.equal(sniffSample(mp3), "mp3");
  });

  it("refuses non-audio, tiny and oversized files", () => {
    const html = new Uint8Array(MIN_SAMPLE_BYTES + 10);
    html.set([...Buffer.from("<html><body>x</body></html>")]);
    assert.deepEqual(checkSample(html), { ok: false, reason: "not_audio" });
    assert.deepEqual(checkSample(webmSample(100)), { ok: false, reason: "too_small" });
    assert.deepEqual(checkSample(new Uint8Array(11 * 1024 * 1024)), {
      ok: false,
      reason: "too_large",
    });
    assert.equal(checkSample(webmSample()).ok, true);
  });
});

describe("verification challenge", () => {
  const base = { secret: SECRET, organizationId: "org_a", userId: "usr_1", now: NOW };

  it("gives three distinct words and verifies for the same business and user", async () => {
    const issued = await issueChallenge({ ...base, locale: "en" });
    assert.equal(issued.words.length, 3);
    assert.equal(new Set(issued.words).size, 3);

    const checked = await verifyChallengeToken({ ...base, token: issued.token });
    assert.equal(checked.ok, true);
    if (checked.ok) {
      assert.deepEqual(
        checked.words.map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "")),
        issued.words.map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "")),
      );
    }
  });

  it("is useless to another business, another user, or after tampering", async () => {
    const issued = await issueChallenge({ ...base, locale: "en" });
    for (const other of [
      { ...base, organizationId: "org_b" },
      { ...base, userId: "usr_2" },
      { ...base, secret: "a-different-secret-a-different-secret" },
    ]) {
      const result = await verifyChallengeToken({ ...other, token: issued.token });
      assert.deepEqual(result, { ok: false, reason: "invalid" });
    }
    const [payload, signature] = issued.token.split(".");
    for (const token of [
      `${payload}.${signature}x`,
      `${payload}x.${signature}`,
      `${payload}`,
      "",
      "not.a.token",
      `${payload}.${signature}.extra`,
    ]) {
      const result = await verifyChallengeToken({ ...base, token });
      assert.equal(result.ok, false, token);
    }
  });

  it("expires", async () => {
    const issued = await issueChallenge({ ...base, locale: "fr" });
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    const result = await verifyChallengeToken({ ...base, now: later, token: issued.token });
    assert.deepEqual(result, { ok: false, reason: "expired" });
  });

  it("each challenge is different", async () => {
    const a = await issueChallenge({ ...base, locale: "en" });
    const b = await issueChallenge({ ...base, locale: "en" });
    assert.notEqual(a.token, b.token);
  });
});

describe("transcript matching", () => {
  it("finds the words regardless of case, accents and punctuation", () => {
    assert.equal(
      transcriptHasChallenge("Hello, my voice. RIVER... maple; copper!", ["river", "maple", "copper"]),
      true,
    );
    assert.equal(
      transcriptHasChallenge("la rivière et l'érable", ["riviere", "erable"]),
      true,
    );
  });

  it("tolerates one letter of speech-to-text slip on long words only", () => {
    assert.equal(transcriptHasChallenge("lantern", ["lanterns"]), true);
    assert.equal(transcriptHasChallenge("the cat", ["cap"]), false);
    assert.equal(transcriptHasChallenge("river maple", ["river", "maple", "copper"]), false);
    assert.equal(transcriptHasChallenge("", ["river"]), false);
  });

  it("counts words", () => {
    assert.deepEqual(normalizeSpeech("Hi,  there!"), ["hi", "there"]);
    assert.equal(wordCount("one two three"), 3);
  });
});

describe("ElevenLabs client", () => {
  function recorder(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return handler(String(url), init ?? {});
    }) as typeof fetch;
    return { calls, fetchImpl };
  }
  const sample = { bytes: webmSample(), filename: "sample.webm", mime: "audio/webm" };

  it("creates a voice with the key in a header, never in the URL", async () => {
    const { calls, fetchImpl } = recorder(
      () => new Response(JSON.stringify({ voice_id: "abcDEF1234567890" }), { status: 200 }),
    );
    const client = createElevenLabsClient({ apiKey: "xi-secret", fetchImpl });
    const result = await client.createVoice({
      name: "n",
      description: "d",
      labels: { source: "tradecatch" },
      sample,
    });
    assert.equal(result.voiceId, "abcDEF1234567890");
    assert.equal(calls[0]!.url, "https://api.elevenlabs.io/v1/voices/add");
    assert.equal(calls[0]!.url.includes("xi-secret"), false);
    assert.equal((calls[0]!.init.headers as Record<string, string>)["xi-api-key"], "xi-secret");
  });

  it("treats an already-deleted voice as deleted, but surfaces other failures", async () => {
    const gone = createElevenLabsClient({
      apiKey: "k",
      fetchImpl: recorder(() => new Response("{}", { status: 404 })).fetchImpl,
    });
    await gone.deleteVoice("abcDEF1234567890");

    const broken = createElevenLabsClient({
      apiKey: "k",
      fetchImpl: recorder(() => new Response("{}", { status: 500 })).fetchImpl,
    });
    await assert.rejects(broken.deleteVoice("abcDEF1234567890"), (e: unknown) => {
      return e instanceof ProviderError && e.failure === "unavailable";
    });
  });

  it("maps failures to small categories without leaking the provider's text", async () => {
    for (const [status, failure] of [
      [401, "unauthorized"],
      [402, "quota"],
      [422, "invalid_sample"],
      [429, "rate_limited"],
    ] as const) {
      const client = createElevenLabsClient({
        apiKey: "k",
        fetchImpl: recorder(
          () => new Response("secret provider detail xi-api-key=k", { status }),
        ).fetchImpl,
      });
      await assert.rejects(client.transcribe(sample), (e: unknown) => {
        assert.ok(e instanceof ProviderError);
        assert.equal(e.failure, failure);
        assert.equal(e.message.includes("secret provider detail"), false);
        return true;
      });
    }
  });

  it("a network error or timeout is reported as unavailable", async () => {
    const client = createElevenLabsClient({
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed https://api.elevenlabs.io/?key=k");
      }) as typeof fetch,
    });
    await assert.rejects(client.synthesize({ voiceId: "abcDEF1234567890", text: "hi" }), (e) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.failure, "unavailable");
      assert.equal(e.message.includes("key=k"), false);
      return true;
    });
  });

  it("rejects responses without a usable voice id or audio", async () => {
    const noId = createElevenLabsClient({
      apiKey: "k",
      fetchImpl: recorder(() => new Response("{}", { status: 200 })).fetchImpl,
    });
    await assert.rejects(noId.createVoice({ name: "n", description: "d", labels: {}, sample }));
    const empty = createElevenLabsClient({
      apiKey: "k",
      fetchImpl: recorder(() => new Response(new Uint8Array(0), { status: 200 })).fetchImpl,
    });
    await assert.rejects(empty.synthesize({ voiceId: "abcDEF1234567890", text: "hi" }));
  });
});

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

type FakeProvider = VoiceProvider & {
  created: string[];
  deleted: string[];
  failNext: Partial<Record<"transcribe" | "createVoice" | "deleteVoice" | "synthesize", boolean>>;
  transcript: string;
};

function fakeProvider(transcript = ""): FakeProvider {
  let counter = 0;
  const p: FakeProvider = {
    created: [],
    deleted: [],
    failNext: {},
    transcript,
    async createVoice() {
      if (p.failNext.createVoice) throw new ProviderError("unavailable");
      counter += 1;
      const voiceId = `voiceAbc${String(counter).padStart(8, "0")}`;
      p.created.push(voiceId);
      return { voiceId };
    },
    async deleteVoice(voiceId) {
      if (p.failNext.deleteVoice) throw new ProviderError("unavailable");
      p.deleted.push(voiceId);
    },
    async synthesize() {
      if (p.failNext.synthesize) throw new ProviderError("unavailable");
      return { audio: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" };
    },
    async transcribe() {
      if (p.failNext.transcribe) throw new ProviderError("unavailable");
      return { text: p.transcript };
    },
  };
  return p;
}

const plus: VoiceActor = { organizationId: "org_a", plan: "receptionist", userId: "usr_1" };
const growth: VoiceActor = { organizationId: "org_g", plan: "growth", userId: "usr_9" };

function setup(provider: FakeProvider | null = fakeProvider()) {
  let tick = 0;
  const store = createMemoryVoiceStore();
  const service = createVoiceService({
    store,
    provider,
    challengeSecret: SECRET,
    now: () => new Date(NOW.getTime() + tick++ * 1000),
  });
  return { service, store, provider };
}

const consent = {
  accepted: true,
  statementVersion: CONSENT_STATEMENT_VERSION,
  signerName: "Jo Acme",
};

/** A transcript that says the challenge words and is long enough. */
function spokenFor(words: string[]): string {
  return `Hello this is my voice and I am recording it so that my receptionist can sound like me ${words.join(
    " ",
  )} thank you very much for listening`;
}

async function cloneOk(
  ctx: ReturnType<typeof setup>,
  actor: VoiceActor = plus,
  locale: "en" | "fr" = "en",
) {
  const challenge = await ctx.service.challenge(actor, locale);
  assert.ok(challenge.ok);
  ctx.provider!.transcript = spokenFor(challenge.challenge.words);
  return ctx.service.createClone(actor, {
    consent,
    challengeToken: challenge.challenge.token,
    sample: webmSample(),
  });
}

describe("custom voice service — entitlement", () => {
  it("a non-Plus business cannot get a challenge, clone, preview or activate", async () => {
    const ctx = setup();
    assert.deepEqual(await ctx.service.challenge(growth, "en"), {
      ok: false,
      error: "not_entitled",
    });
    assert.deepEqual(
      await ctx.service.createClone(growth, {
        consent,
        challengeToken: "x",
        sample: webmSample(),
      }),
      { ok: false, error: "not_entitled" },
    );
    assert.deepEqual(await ctx.service.preview(growth, "en"), { ok: false, error: "not_entitled" });
    assert.deepEqual(await ctx.service.setMode(growth, "custom"), {
      ok: false,
      error: "not_entitled",
    });
    assert.equal((await ctx.service.status(growth)).entitled, false);
    assert.equal(ctx.provider!.created.length, 0);
  });

  it("reports unavailable when the provider is not configured", async () => {
    const ctx = setup(null);
    assert.deepEqual(await ctx.service.challenge(plus, "en"), { ok: false, error: "unavailable" });
    assert.equal((await ctx.service.status(plus)).available, false);
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "receptionist"), {
      mode: "standard",
    });
  });
});

describe("custom voice service — cloning", () => {
  it("clones after consent and a verified challenge, but does not go live by itself", async () => {
    const ctx = setup();
    const result = await cloneOk(ctx);
    assert.ok(result.ok);
    assert.equal(result.status.hasVoice, true);
    assert.equal(result.status.mode, "standard");
    assert.equal(result.status.live, false);
    assert.equal(result.status.previewed, false);
    assert.equal(result.status.consent?.signerName, "Jo Acme");
    assert.equal(ctx.provider!.created.length, 1);
    // The browser view never carries the voice id.
    assert.equal(JSON.stringify(result.status).includes(ctx.provider!.created[0]!), false);
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "receptionist"), {
      mode: "standard",
    });
  });

  it("requires explicit consent, a name and the current wording before anything is sent", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.transcript = spokenFor(challenge.challenge.words);
    const base = { challengeToken: challenge.challenge.token, sample: webmSample() };

    for (const bad of [
      { ...consent, accepted: false },
      { ...consent, signerName: " " },
      { ...consent, signerName: "x".repeat(121) },
    ]) {
      assert.deepEqual(await ctx.service.createClone(plus, { ...base, consent: bad }), {
        ok: false,
        error: "consent_required",
      });
    }
    assert.deepEqual(
      await ctx.service.createClone(plus, {
        ...base,
        consent: { ...consent, statementVersion: "1999-old" },
      }),
      { ok: false, error: "consent_outdated" },
    );
    assert.equal(ctx.provider!.created.length, 0);
  });

  it("fails closed when the challenge words are not in the recording", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.transcript = spokenFor(["something", "completely", "different"]);
    assert.deepEqual(
      await ctx.service.createClone(plus, {
        consent,
        challengeToken: challenge.challenge.token,
        sample: webmSample(),
      }),
      { ok: false, error: "challenge_failed" },
    );
    assert.equal(ctx.provider!.created.length, 0);
    assert.equal((await ctx.service.status(plus)).hasVoice, false);
  });

  it("fails closed when the transcription itself fails", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.failNext.transcribe = true;
    assert.deepEqual(
      await ctx.service.createClone(plus, {
        consent,
        challengeToken: challenge.challenge.token,
        sample: webmSample(),
      }),
      { ok: false, error: "provider_error" },
    );
    assert.equal(ctx.provider!.created.length, 0);
  });

  it("rejects a recording that is too short to be the whole script", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.transcript = challenge.challenge.words.join(" ");
    assert.deepEqual(
      await ctx.service.createClone(plus, {
        consent,
        challengeToken: challenge.challenge.token,
        sample: webmSample(),
      }),
      { ok: false, error: "sample_too_short" },
    );
  });

  it("rejects non-audio, tiny files, bad and other-tenant challenge tokens", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.transcript = spokenFor(challenge.challenge.words);

    assert.deepEqual(
      await ctx.service.createClone(plus, {
        consent,
        challengeToken: challenge.challenge.token,
        sample: new Uint8Array(MIN_SAMPLE_BYTES + 5),
      }),
      { ok: false, error: "sample_invalid" },
    );
    assert.deepEqual(
      await ctx.service.createClone(plus, {
        consent,
        challengeToken: challenge.challenge.token,
        sample: webmSample(500),
      }),
      { ok: false, error: "sample_too_short" },
    );
    assert.deepEqual(
      await ctx.service.createClone(plus, {
        consent,
        challengeToken: "garbage",
        sample: webmSample(),
      }),
      { ok: false, error: "challenge_invalid" },
    );
    // A token issued to business A does not work for business B.
    const otherPlus: VoiceActor = { organizationId: "org_b", plan: "receptionist", userId: "usr_1" };
    assert.deepEqual(
      await ctx.service.createClone(otherPlus, {
        consent,
        challengeToken: challenge.challenge.token,
        sample: webmSample(),
      }),
      { ok: false, error: "challenge_invalid" },
    );
    assert.equal(ctx.provider!.created.length, 0);
  });

  it("a challenge cannot be used a second time", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.transcript = spokenFor(challenge.challenge.words);
    const input = { consent, challengeToken: challenge.challenge.token, sample: webmSample() };
    assert.ok((await ctx.service.createClone(plus, input)).ok);
    assert.deepEqual(await ctx.service.createClone(plus, input), {
      ok: false,
      error: "challenge_reused",
    });
    assert.equal(ctx.provider!.created.length, 1);
  });

  it("re-recording replaces the voice, deletes the old one and resets activation", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    assert.ok((await ctx.service.preview(plus, "en")).ok);
    assert.ok((await ctx.service.setMode(plus, "custom")).ok);

    const again = await cloneOk(ctx);
    assert.ok(again.ok);
    assert.equal(again.status.mode, "standard");
    assert.equal(again.status.previewed, false);
    assert.deepEqual(ctx.provider!.deleted, [ctx.provider!.created[0]]);
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "receptionist"), {
      mode: "standard",
    });
  });

  it("does not leave an orphan clone at the provider if the provider create fails", async () => {
    const ctx = setup();
    const challenge = await ctx.service.challenge(plus, "en");
    assert.ok(challenge.ok);
    ctx.provider!.transcript = spokenFor(challenge.challenge.words);
    ctx.provider!.failNext.createVoice = true;
    const result = await ctx.service.createClone(plus, {
      consent,
      challengeToken: challenge.challenge.token,
      sample: webmSample(),
    });
    assert.deepEqual(result, { ok: false, error: "provider_error" });
    assert.equal((await ctx.service.status(plus)).hasVoice, false);
  });
});

describe("custom voice service — preview and activation", () => {
  it("must be previewed before it can be activated", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    assert.deepEqual(await ctx.service.setMode(plus, "custom"), {
      ok: false,
      error: "not_previewed",
    });

    const preview = await ctx.service.preview(plus, "fr");
    assert.ok(preview.ok);
    assert.equal(preview.contentType, "audio/mpeg");

    const live = await ctx.service.setMode(plus, "custom");
    assert.ok(live.ok);
    assert.equal(live.status.live, true);

    const voice = await ctx.service.resolveForAgent("org_a", "receptionist");
    assert.equal(voice.mode, "custom");
    if (voice.mode === "custom") {
      assert.equal(voice.voiceId, ctx.provider!.created[0]);
      assert.equal(voice.provider, "elevenlabs");
    }
  });

  it("can always switch back to the standard voice", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    await ctx.service.preview(plus, "en");
    await ctx.service.setMode(plus, "custom");
    const back = await ctx.service.setMode(plus, "standard");
    assert.ok(back.ok);
    assert.equal(back.status.mode, "standard");
    assert.equal(back.status.hasVoice, true);
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "receptionist"), {
      mode: "standard",
    });
  });

  it("activating without a voice is refused", async () => {
    const ctx = setup();
    assert.deepEqual(await ctx.service.setMode(plus, "custom"), { ok: false, error: "no_voice" });
    assert.deepEqual(await ctx.service.preview(plus, "en"), { ok: false, error: "no_voice" });
  });

  it("a failed preview does not count as previewed", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    ctx.provider!.failNext.synthesize = true;
    assert.deepEqual(await ctx.service.preview(plus, "en"), { ok: false, error: "provider_error" });
    assert.deepEqual(await ctx.service.setMode(plus, "custom"), {
      ok: false,
      error: "not_previewed",
    });
  });
});

describe("custom voice service — downgrade and fallback", () => {
  it("a downgrade stops the cloned voice on the very next call", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    await ctx.service.preview(plus, "en");
    await ctx.service.setMode(plus, "custom");
    assert.equal((await ctx.service.resolveForAgent("org_a", "receptionist")).mode, "custom");
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "growth"), { mode: "standard" });
    // Coming back to Plus restores it without re-recording.
    assert.equal((await ctx.service.resolveForAgent("org_a", "receptionist")).mode, "custom");
  });

  it("a downgraded business can still delete its voice and switch back", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    const downgraded: VoiceActor = { ...plus, plan: "starter" };
    assert.ok((await ctx.service.setMode(downgraded, "standard")).ok);
    const deleted = await ctx.service.deleteVoice(downgraded);
    assert.ok(deleted.ok);
    assert.equal(deleted.status.hasVoice, false);
    assert.deepEqual(ctx.provider!.deleted, [ctx.provider!.created[0]]);
  });

  it("a store failure resolves to the standard voice instead of throwing", async () => {
    const store = createMemoryVoiceStore();
    store.get = async () => {
      throw new Error("db down");
    };
    const service = createVoiceService({
      store,
      provider: fakeProvider(),
      challengeSecret: SECRET,
    });
    assert.deepEqual(await service.resolveForAgent("org_a", "receptionist"), { mode: "standard" });
  });
});

describe("custom voice service — deletion and consent revocation", () => {
  async function liveVoice() {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    await ctx.service.preview(plus, "en");
    assert.ok((await ctx.service.setMode(plus, "custom")).ok);
    return ctx;
  }

  it("revoking consent stops the voice, deletes it at the provider and needs fresh consent", async () => {
    const ctx = await liveVoice();
    const revoked = await ctx.service.revokeConsent(plus);
    assert.ok(revoked.ok);
    assert.equal(revoked.status.hasVoice, false);
    assert.equal(revoked.status.live, false);
    assert.equal(revoked.status.consent, null);
    assert.ok(revoked.status.consentRevokedAt);
    assert.deepEqual(ctx.provider!.deleted, [ctx.provider!.created[0]]);
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "receptionist"), {
      mode: "standard",
    });
    // And it cannot be switched back on.
    assert.deepEqual(await ctx.service.setMode(plus, "custom"), { ok: false, error: "no_voice" });
  });

  it("deleting removes the voice everywhere and is safe to repeat", async () => {
    const ctx = await liveVoice();
    const first = await ctx.service.deleteVoice(plus);
    assert.ok(first.ok);
    assert.equal(first.status.hasVoice, false);
    const second = await ctx.service.deleteVoice(plus);
    assert.ok(second.ok);
    assert.equal(ctx.provider!.deleted.length, 1);
  });

  it("if the provider cannot delete, the voice is already off the calls and the delete can be retried", async () => {
    const ctx = await liveVoice();
    ctx.provider!.failNext.deleteVoice = true;
    const pending = await ctx.service.deleteVoice(plus);
    assert.ok(pending.ok);
    assert.equal(pending.status.cleanupPending, true);
    assert.equal(pending.status.live, false);
    assert.deepEqual(await ctx.service.resolveForAgent("org_a", "receptionist"), {
      mode: "standard",
    });
    assert.deepEqual(await ctx.service.setMode(plus, "custom"), { ok: false, error: "no_voice" });

    ctx.provider!.failNext.deleteVoice = false;
    const retried = await ctx.service.deleteVoice(plus);
    assert.ok(retried.ok);
    assert.equal(retried.status.cleanupPending, false);
    assert.equal(retried.status.hasVoice, false);
    assert.equal(ctx.provider!.deleted.length, 1);
  });

  it("purging a business removes its voice at the provider", async () => {
    const ctx = await liveVoice();
    assert.equal(await ctx.service.purgeOrganization("org_a"), true);
    assert.deepEqual(ctx.provider!.deleted, [ctx.provider!.created[0]]);
    assert.equal(await ctx.service.purgeOrganization("org_a"), true);

    const ctx2 = await liveVoice();
    ctx2.provider!.failNext.deleteVoice = true;
    assert.equal(await ctx2.service.purgeOrganization("org_a"), false);
  });
});

describe("custom voice service — tenant isolation", () => {
  it("one business never sees or uses another business's voice", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    await ctx.service.preview(plus, "en");
    await ctx.service.setMode(plus, "custom");

    const other: VoiceActor = { organizationId: "org_b", plan: "receptionist", userId: "usr_5" };
    const status = await ctx.service.status(other);
    assert.equal(status.hasVoice, false);
    assert.equal(status.mode, "standard");
    assert.deepEqual(await ctx.service.resolveForAgent("org_b", "receptionist"), {
      mode: "standard",
    });
    assert.deepEqual(await ctx.service.preview(other, "en"), { ok: false, error: "no_voice" });
    assert.deepEqual(await ctx.service.setMode(other, "custom"), { ok: false, error: "no_voice" });
    // Deleting "their" voice touches nothing of A's.
    assert.ok((await ctx.service.deleteVoice(other)).ok);
    assert.equal((await ctx.service.status(plus)).hasVoice, true);
    assert.equal(ctx.provider!.deleted.length, 0);
    assert.deepEqual((await ctx.service.events(other)).length, 0);
  });
});

describe("custom voice service — audit trail", () => {
  it("records consent, clone, preview, activation and deletion without secrets", async () => {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    await ctx.service.preview(plus, "en");
    await ctx.service.setMode(plus, "custom");
    await ctx.service.deleteVoice(plus);
    const actions = (await ctx.service.events(plus)).map((e) => e.action).sort();
    assert.deepEqual(actions, ["activated", "clone_created", "consent_given", "deleted", "previewed"]);
    const serialized = JSON.stringify(await ctx.service.events(plus));
    assert.equal(serialized.includes(ctx.provider!.created[0]!), false);
  });
});

/* -------------------------------------------------------------------------- */
/* What the call worker is told                                               */
/* -------------------------------------------------------------------------- */

describe("agent voice resolution", () => {
  it("only business-owned configs have an organization", () => {
    assert.equal(organizationIdFromConfigId("rc_org_org_123"), "org_123");
    assert.equal(organizationIdFromConfigId("rc_demo"), null);
    assert.equal(organizationIdFromConfigId("rc_org_"), null);
  });

  async function liveService() {
    const ctx = setup();
    assert.ok((await cloneOk(ctx)).ok);
    await ctx.service.preview(plus, "en");
    await ctx.service.setMode(plus, "custom");
    return ctx;
  }

  it("a Plus business with an activated voice gets it; the plan is read from the stored organization", async () => {
    const ctx = await liveService();
    const plans: Record<string, "receptionist" | "growth"> = { org_a: "receptionist" };
    const deps = {
      getOrganization: async (id: string) => (plans[id] ? { id, plan: plans[id]! } : null),
      voices: ctx.service,
    };
    const voice = await resolveAgentVoice("rc_org_org_a", deps);
    assert.equal(voice.mode, "custom");

    plans.org_a = "growth"; // downgraded
    assert.deepEqual(await resolveAgentVoice("rc_org_org_a", deps), { mode: "standard" });
  });

  it("another business, a non-business config, a missing organization or an outage all give the standard voice", async () => {
    const ctx = await liveService();
    const deps = {
      getOrganization: async (id: string) =>
        id === "org_b" ? { id, plan: "receptionist" as const } : null,
      voices: ctx.service,
    };
    assert.deepEqual(await resolveAgentVoice("rc_org_org_b", deps), { mode: "standard" });
    assert.deepEqual(await resolveAgentVoice("rc_org_org_gone", deps), { mode: "standard" });
    assert.deepEqual(await resolveAgentVoice("rc_demo", deps), { mode: "standard" });
    assert.deepEqual(
      await resolveAgentVoice("rc_org_org_a", {
        getOrganization: async () => {
          throw new Error("db down");
        },
        voices: ctx.service,
      }),
      { mode: "standard" },
    );
  });
});

describe("agent config carries the voice", () => {
  const config = buildProfileConfig(
    {
      organizationId: "org_a",
      phoneNumberE164: "+14385597100",
      activated: true,
      settings: profileSettingsSchema.parse({
        knowledge: { companyName: "Nord Plomberie" },
        notifyEmail: "owner@example.com",
      }),
      updatedAt: new Date().toISOString(),
    },
    { client: demoClientAccount({ id: "client_a", contractorDisplayName: "Nord Plomberie" }) },
  );
  const OPEN = new Date("2026-10-28T15:00:00Z");

  it("defaults to the standard voice and does not add the owner-voice line", () => {
    const built = buildAgentConfig(config, OPEN);
    assert.deepEqual(built.voice, { mode: "standard" });
    assert.equal(built.instructions.includes("recording of the business owner"), false);
    // The rest of the config is untouched by the voice option.
    assert.equal(built.businessName, "Nord Plomberie");
    assert.ok(built.languageSelect.opening.statement.text.length > 0);
  });

  it("a cloned voice is passed through and the receptionist stays honest about being virtual", () => {
    const custom = {
      mode: "custom",
      provider: "elevenlabs",
      voiceId: "voiceAbc00000001",
      model: "eleven_flash_v2_5",
    } as const;
    const built = buildAgentConfig(config, OPEN, custom);
    assert.deepEqual(built.voice, custom);
    assert.match(built.instructions, /never say or imply that you are the owner or a human/);
    // Existing receptionist behaviour is still described.
    assert.match(built.instructions, /record_details/);
    assert.match(built.instructions, /transfer|No live transfer/);
  });
});

describe("GET /api/receptionist/agent-config", () => {
  const saved = { ...process.env };
  const SECRET_OPS = "s3cret-s3cret";

  beforeEach(() => {
    process.env.MISSED_CALL_OPS_SECRET = SECRET_OPS;
    process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([
      {
        id: "rc_agent_voice",
        clientAccountId: "client_agent_voice",
        phoneNumberE164: "+14385550100",
        businessName: "Nord Plomberie",
        languages: ["fr", "en"],
        defaultLanguage: "fr",
        notifications: [],
      },
    ]);
    resetReceptionistRuntimeForTests();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetReceptionistRuntimeForTests();
  });

  it("answers with the standard voice for a number without a cloned voice", async () => {
    const response = await agentConfigRoute(
      new NextRequest("http://localhost/api/receptionist/agent-config?number=%2B14385550100", {
        headers: { authorization: `Bearer ${SECRET_OPS}` },
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { config: { voice: unknown; businessName: string } };
    assert.deepEqual(body.config.voice, { mode: "standard" });
    assert.equal(body.config.businessName, "Nord Plomberie");
  });

  it("still requires the ops secret", async () => {
    const response = await agentConfigRoute(
      new NextRequest("http://localhost/api/receptionist/agent-config?number=%2B14385550100"),
    );
    assert.equal(response.status, 401);
  });
});

/* -------------------------------------------------------------------------- */
/* Postgres store: SQL shape (no database needed)                             */
/* -------------------------------------------------------------------------- */

describe("custom voice Postgres store", () => {
  type Query = { sql: string; values: unknown[] };

  function fakePool(rows: Record<string, unknown>[] = []) {
    const queries: Query[] = [];
    const pool = {
      async query(sql: string, values: unknown[] = []) {
        queries.push({ sql, values });
        return { rows };
      },
    };
    return { pool: pool as unknown as import("pg").Pool, queries };
  }

  /** Postgres rejects a statement whose $n placeholders and values do not line up. */
  function assertPlaceholdersMatch({ sql, values }: Query) {
    const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    const expected = new Set(values.map((_, i) => i + 1));
    assert.deepEqual([...used].sort((a, b) => a - b), [...expected].sort((a, b) => a - b), sql);
  }

  const record = {
    ...emptyVoiceRecord("org_a", "2026-11-01T12:00:00.000Z"),
    mode: "custom" as const,
    status: "ready" as const,
    providerVoiceId: "abcDEF1234567890",
    consent: {
      statementVersion: CONSENT_STATEMENT_VERSION,
      signerName: "Jo Acme",
      acceptedByUserId: "usr_1",
      acceptedAt: "2026-11-01T12:00:00.000Z",
    },
    previewedAt: "2026-11-01T12:01:00.000Z",
  };

  it("every statement binds exactly the parameters it declares, scoped by organization", async () => {
    const { pool, queries } = fakePool();
    const store = createPostgresVoiceStore(pool);
    await store.get("org_a");
    await store.save(record); // insert (version 0)
    await store.save({ ...record, version: 3 }); // update
    await store.remove("org_a");
    await store.addEvent({
      organizationId: "org_a",
      actorUserId: "usr_1",
      action: "previewed",
      detail: {},
      createdAt: "2026-11-01T12:02:00.000Z",
    });
    await store.listEvents("org_a", 10);

    assert.equal(queries.length, 6);
    for (const query of queries) {
      assertPlaceholdersMatch(query);
      assert.match(query.sql, /organization_id\s*=\s*\$1|VALUES \(\$1,\$2/);
      // Never string-built from input: the voice id and name only travel as values.
      assert.equal(query.sql.includes("abcDEF1234567890"), false);
      assert.equal(query.sql.includes("Jo Acme"), false);
    }
    const update = queries[2]!;
    assert.match(update.sql, /WHERE organization_id = \$1 AND version = \$16/);
    assert.equal(update.values.at(-1), 3);
    assert.equal(update.values[0], "org_a");
  });

  it("reads a row back into a record (and never invents consent)", async () => {
    const { pool } = fakePool([
      {
        organization_id: "org_a",
        mode: "standard",
        status: "none",
        provider_voice_id: null,
        consent_statement_version: null,
        consent_signer_name: null,
        consent_accepted_by_user_id: null,
        consent_accepted_at: null,
        consent_revoked_at: null,
        consent_revoked_by: null,
        verified_at: null,
        previewed_at: null,
        activated_at: null,
        last_challenge_nonce: null,
        version: 2,
        created_at: new Date("2026-11-01T12:00:00Z"),
        updated_at: new Date("2026-11-01T12:00:00Z"),
      },
    ]);
    const got = await createPostgresVoiceStore(pool).get("org_a");
    assert.ok(got);
    assert.equal(got.consent, null);
    assert.equal(got.providerVoiceId, null);
    assert.equal(got.version, 2);
    assert.equal(got.createdAt, "2026-11-01T12:00:00.000Z");
  });
});
