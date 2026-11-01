import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { DELETE, GET, PUT } from "../../src/app/api/app/receptionist/voice/route";
import { POST as challengeRoute } from "../../src/app/api/app/receptionist/voice/challenge/route";
import { POST as cloneRoute } from "../../src/app/api/app/receptionist/voice/clone/route";
import { POST as previewRoute } from "../../src/app/api/app/receptionist/voice/preview/route";
import { POST as revokeRoute } from "../../src/app/api/app/receptionist/voice/revoke/route";
import type { VoiceProvider } from "../../src/product/receptionist/custom-voice/elevenlabs";
import {
  CONSENT_STATEMENT_VERSION,
  MIN_SAMPLE_BYTES,
} from "../../src/product/receptionist/custom-voice/model";
import { createVoiceService, type VoiceService } from "../../src/product/receptionist/custom-voice/service";
import { createMemoryVoiceStore } from "../../src/product/receptionist/custom-voice/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";

const names = ["AUTH_SECRET", "NODE_ENV"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
  __tradecatchCustomVoice?: VoiceService;
};
const BASE = "https://tradecatch.test/api/app/receptionist/voice";

let store: SaasStore;
let provider: VoiceProvider & { created: string[]; deleted: string[]; transcript: string };

function fakeProvider() {
  let n = 0;
  const p = {
    created: [] as string[],
    deleted: [] as string[],
    transcript: "",
    async createVoice() {
      n += 1;
      const voiceId = `routeVoice${String(n).padStart(8, "0")}`;
      p.created.push(voiceId);
      return { voiceId };
    },
    async deleteVoice(voiceId: string) {
      p.deleted.push(voiceId);
    },
    async synthesize() {
      return { audio: new Uint8Array([1, 2, 3, 4]), contentType: "audio/mpeg" };
    },
    async transcribe() {
      return { text: p.transcript };
    },
  };
  return p;
}

beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  process.env.AUTH_SECRET = "voice-routes-unit-secret-not-for-production";
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  store = createMemorySaasStore();
  runtime.__tradecatchSaas = { store, durable: false };
  provider = fakeProvider();
  runtime.__tradecatchCustomVoice = createVoiceService({
    store: createMemoryVoiceStore(),
    provider,
    challengeSecret: "voice-routes-challenge-secret",
  });
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  delete runtime.__tradecatchCustomVoice;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function fixture(
  plan: "starter" | "growth" | "receptionist",
  role: "owner" | "admin" | "member" | "viewer" = "owner",
) {
  const f = await store.createOrganizationWithOwner({
    name: "Voice fixture",
    ownerName: "Owner",
    ownerEmail: crypto.randomUUID() + "@example.test",
  });
  await store.updateOrganizationPlan(f.organization.id, plan);
  await store.setMembershipRole(f.organization.id, f.user.id, role);
  const session = {
    id: crypto.randomUUID(),
    organizationId: f.organization.id,
    userId: f.user.id,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await store.createSession(session);
  const cookie = await signSessionClaims(
    {
      sid: session.id,
      uid: f.user.id,
      oid: f.organization.id,
      plan,
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    process.env.AUTH_SECRET!,
  );
  return { ...f, cookie: "tc_session=" + cookie };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function req(method: string, cookie: string | null, path = "", body?: unknown) {
  return new NextRequest(BASE + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function call(
  handler: (request: NextRequest) => Promise<Response> | Response,
  request: NextRequest,
) {
  const response = await withRequest(request, () => handler(request));
  assert.ok(response);
  return response;
}
const callNoArg = (handler: () => Promise<Response>, request: NextRequest) =>
  withRequest(request, () => handler()) as Promise<Response>;

function webm(size = MIN_SAMPLE_BYTES + 100): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  return bytes;
}

function cloneRequest(
  f: Fixture,
  fields: Record<string, string>,
  sample: Uint8Array<ArrayBuffer> | null = webm(),
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (sample) form.set("sample", new Blob([sample], { type: "audio/webm" }), "sample.webm");
  return new NextRequest(BASE + "/clone", {
    method: "POST",
    headers: { cookie: f.cookie },
    body: form,
  });
}

async function createVoiceThroughApi(f: Fixture) {
  const challenge = await call(challengeRoute, req("POST", f.cookie, "/challenge", { locale: "en" }));
  assert.equal(challenge.status, 200);
  const issued = (await challenge.json()) as {
    challenge: { token: string; words: string[] };
    consentVersion: string;
  };
  provider.transcript = `Hello this is my voice and I am recording it so that my receptionist can sound like me ${issued.challenge.words.join(
    " ",
  )} thank you very much for listening to this recording today`;
  const response = await call(
    cloneRoute,
    cloneRequest(f, {
      consentAccepted: "true",
      consentVersion: issued.consentVersion,
      signerName: "Jo Acme",
      challengeToken: issued.challenge.token,
    }),
  );
  return response;
}

describe("receptionist voice API — access", () => {
  it("requires a signed-in session", async () => {
    const request = req("GET", null);
    const response = await callNoArg(GET, request);
    assert.equal(response.status, 401);
  });

  it("a non-Plus plan sees the feature as locked and every change is refused with an upgrade hint", async () => {
    const f = await fixture("growth");
    const status = await callNoArg(GET, req("GET", f.cookie));
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as { status: { entitled: boolean } }).status.entitled, false);

    const challenge = await call(challengeRoute, req("POST", f.cookie, "/challenge", { locale: "en" }));
    assert.equal(challenge.status, 403);
    const body = (await challenge.json()) as { code: string; upgrade?: string };
    assert.equal(body.code, "not_entitled");
    assert.equal(body.upgrade, "receptionist");

    const mode = await call(PUT, req("PUT", f.cookie, "", { mode: "custom" }));
    assert.equal(mode.status, 403);
    const clone = await call(
      cloneRoute,
      cloneRequest(f, {
        consentAccepted: "true",
        consentVersion: CONSENT_STATEMENT_VERSION,
        signerName: "Jo",
        challengeToken: "x",
      }),
    );
    assert.equal(clone.status, 403);
    assert.equal(provider.created.length, 0);
  });

  it("a team member (not owner/admin) can look but not change anything", async () => {
    const f = await fixture("receptionist", "member");
    assert.equal((await callNoArg(GET, req("GET", f.cookie))).status, 200);
    for (const response of [
      await call(PUT, req("PUT", f.cookie, "", { mode: "standard" })),
      await call(challengeRoute, req("POST", f.cookie, "/challenge", { locale: "en" })),
      await call(previewRoute, req("POST", f.cookie, "/preview", { locale: "en" })),
      await callNoArg(DELETE, req("DELETE", f.cookie)),
      await callNoArg(revokeRoute, req("POST", f.cookie, "/revoke")),
    ]) {
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { error: string }).error, "Insufficient permissions.");
    }
    assert.equal(provider.created.length, 0);
  });
});

describe("receptionist voice API — Receptionist Plus flow", () => {
  it("record, preview, go live, switch back and delete — without ever exposing the voice id", async () => {
    const f = await fixture("receptionist");

    const created = await createVoiceThroughApi(f);
    assert.equal(created.status, 201);
    const createdText = await created.text();
    assert.equal(createdText.includes(provider.created[0]!), false);
    const createdBody = JSON.parse(createdText) as {
      status: { hasVoice: boolean; live: boolean; mode: string };
    };
    assert.equal(createdBody.status.hasVoice, true);
    assert.equal(createdBody.status.live, false);
    assert.equal(createdBody.status.mode, "standard");

    // Going live before listening is refused.
    const early = await call(PUT, req("PUT", f.cookie, "", { mode: "custom" }));
    assert.equal(early.status, 409);
    assert.equal(((await early.json()) as { code: string }).code, "not_previewed");

    const preview = await call(previewRoute, req("POST", f.cookie, "/preview", { locale: "fr" }));
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "audio/mpeg");
    assert.equal(preview.headers.get("cache-control")?.includes("no-store"), true);
    assert.equal((await preview.arrayBuffer()).byteLength, 4);

    const live = await call(PUT, req("PUT", f.cookie, "", { mode: "custom" }));
    assert.equal(live.status, 200);
    const liveText = await live.text();
    assert.equal(liveText.includes(provider.created[0]!), false);
    assert.equal((JSON.parse(liveText) as { status: { live: boolean } }).status.live, true);

    const back = await call(PUT, req("PUT", f.cookie, "", { mode: "standard" }));
    assert.equal(((await back.json()) as { status: { live: boolean } }).status.live, false);

    const removed = await callNoArg(DELETE, req("DELETE", f.cookie));
    assert.equal(removed.status, 200);
    assert.equal(((await removed.json()) as { status: { hasVoice: boolean } }).status.hasVoice, false);
    assert.deepEqual(provider.deleted, [provider.created[0]]);
  });

  it("withdrawing consent deletes the voice", async () => {
    const f = await fixture("receptionist", "admin");
    assert.equal((await createVoiceThroughApi(f)).status, 201);
    const revoked = await callNoArg(revokeRoute, req("POST", f.cookie, "/revoke"));
    assert.equal(revoked.status, 200);
    const body = (await revoked.json()) as {
      status: { hasVoice: boolean; consent: unknown; consentRevokedAt: string | null };
    };
    assert.equal(body.status.hasVoice, false);
    assert.equal(body.status.consent, null);
    assert.ok(body.status.consentRevokedAt);
    assert.equal(provider.deleted.length, 1);
  });

  it("a business downgraded from Plus can still switch back and delete its voice", async () => {
    const f = await fixture("receptionist");
    assert.equal((await createVoiceThroughApi(f)).status, 201);
    await store.updateOrganizationPlan(f.organization.id, "growth");
    const status = await callNoArg(GET, req("GET", f.cookie));
    assert.equal(((await status.json()) as { status: { entitled: boolean } }).status.entitled, false);
    const switchBack = await call(PUT, req("PUT", f.cookie, "", { mode: "standard" }));
    assert.equal(switchBack.status, 200);
    const activate = await call(PUT, req("PUT", f.cookie, "", { mode: "custom" }));
    assert.equal(activate.status, 403);
    const removed = await callNoArg(DELETE, req("DELETE", f.cookie));
    assert.equal(removed.status, 200);
    assert.equal(provider.deleted.length, 1);
  });
});

describe("receptionist voice API — validation", () => {
  it("refuses a clone without the consent box, a bad mode, and a non-multipart upload", async () => {
    const f = await fixture("receptionist");
    const challenge = await call(challengeRoute, req("POST", f.cookie, "/challenge", { locale: "en" }));
    const issued = (await challenge.json()) as { challenge: { token: string } };

    const noConsent = await call(
      cloneRoute,
      cloneRequest(f, {
        consentVersion: CONSENT_STATEMENT_VERSION,
        signerName: "Jo Acme",
        challengeToken: issued.challenge.token,
      }),
    );
    assert.equal(noConsent.status, 400);
    assert.equal(((await noConsent.json()) as { code: string }).code, "consent_required");

    const badMode = await call(PUT, req("PUT", f.cookie, "", { mode: "robot" }));
    assert.equal(badMode.status, 400);
    const extra = await call(PUT, req("PUT", f.cookie, "", { mode: "custom", organizationId: "org_x" }));
    assert.equal(extra.status, 400);

    const json = await call(cloneRoute, req("POST", f.cookie, "/clone", { hello: "world" }));
    assert.equal(json.status, 400);
    assert.equal(provider.created.length, 0);
  });

  it("refuses an oversized upload instead of buffering it", async () => {
    const f = await fixture("receptionist");
    const response = await call(
      cloneRoute,
      cloneRequest(
        f,
        {
          consentAccepted: "true",
          consentVersion: CONSENT_STATEMENT_VERSION,
          signerName: "Jo Acme",
          challengeToken: "x",
        },
        webm(12 * 1024 * 1024),
      ),
    );
    assert.equal(response.status, 413);
    assert.equal(provider.created.length, 0);
  });

  it("refuses a recording that does not contain the three challenge words", async () => {
    const f = await fixture("receptionist");
    const challenge = await call(challengeRoute, req("POST", f.cookie, "/challenge", { locale: "en" }));
    const issued = (await challenge.json()) as { challenge: { token: string }; consentVersion: string };
    provider.transcript =
      "this is a long enough recording of somebody talking about nothing in particular at all really and it just keeps going for a while longer than twenty words";
    const response = await call(
      cloneRoute,
      cloneRequest(f, {
        consentAccepted: "true",
        consentVersion: issued.consentVersion,
        signerName: "Jo Acme",
        challengeToken: issued.challenge.token,
      }),
    );
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "challenge_failed");
    assert.equal(provider.created.length, 0);
  });
});

describe("receptionist voice API — tenant isolation", () => {
  it("another business sees none of this business's voice and cannot touch it", async () => {
    const a = await fixture("receptionist");
    const b = await fixture("receptionist");
    assert.equal((await createVoiceThroughApi(a)).status, 201);

    const bStatus = (await (await callNoArg(GET, req("GET", b.cookie))).json()) as {
      status: { hasVoice: boolean };
    };
    assert.equal(bStatus.status.hasVoice, false);

    // B asks for a preview, activation and deletion: nothing of A's is used.
    const preview = await call(previewRoute, req("POST", b.cookie, "/preview", { locale: "en" }));
    assert.equal(preview.status, 409);
    const mode = await call(PUT, req("PUT", b.cookie, "", { mode: "custom" }));
    assert.equal(mode.status, 409);
    await callNoArg(DELETE, req("DELETE", b.cookie));
    assert.equal(provider.deleted.length, 0);

    const aStatus = (await (await callNoArg(GET, req("GET", a.cookie))).json()) as {
      status: { hasVoice: boolean };
    };
    assert.equal(aStatus.status.hasVoice, true);
  });

  it("a challenge issued to one business cannot be used by another", async () => {
    const a = await fixture("receptionist");
    const b = await fixture("receptionist");
    const challenge = await call(challengeRoute, req("POST", a.cookie, "/challenge", { locale: "en" }));
    const issued = (await challenge.json()) as { challenge: { token: string; words: string[] }; consentVersion: string };
    provider.transcript = `hello this is my voice and I am recording it so that my receptionist can sound like me ${issued.challenge.words.join(
      " ",
    )} thank you very much for listening to this recording today`;
    const stolen = await call(
      cloneRoute,
      cloneRequest(b, {
        consentAccepted: "true",
        consentVersion: issued.consentVersion,
        signerName: "Someone Else",
        challengeToken: issued.challenge.token,
      }),
    );
    assert.equal(stolen.status, 400);
    assert.equal(((await stolen.json()) as { code: string }).code, "challenge_invalid");
    assert.equal(provider.created.length, 0);
  });
});
