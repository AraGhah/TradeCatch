/**
 * Ordinary SMS must work exactly as well as MMS.
 *
 * Root cause covered here: the optional photo question treated anything but a
 * one-word "no" as a bad answer and replied "Please send a photo as an MMS
 * image", so a customer texting plain text ("no thanks", "pas de photo") was
 * stuck in the step; a photo sent with no text was told their reply was too
 * short. Text-only messages (NumMedia=0) must complete the conversation, MMS
 * attachments must be kept when present, and outbound replies carry no media
 * unless one is attached on purpose.
 */
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/twilio/sms/inbound/route";
import { getCrmService } from "../../src/product/crm/runtime";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemoryStore } from "../../src/product/missed-call/store";
import {
  createMemorySmsPort,
  createTwilioSmsPort,
} from "../../src/product/missed-call/twilio";
import { ensureMissedCallReady } from "../../src/product/missed-call/runtime";
import { getSaasStore } from "../../src/product/saas/runtime";
import type { ClientAccount } from "../../src/product/missed-call/types";

const NOW = new Date("2026-07-22T18:00:00.000Z");
const CALLER = "+15145551234";

async function atPhotoStep(
  options: { requirePhoto?: boolean; language?: "FR" | "EN" } = {},
) {
  const store = createMemoryStore();
  const sms = createMemorySmsPort();
  const base = demoClientAccount();
  const client: ClientAccount = options.requirePhoto
    ? {
        ...base,
        approvedQuestions: base.approvedQuestions.map((q) =>
          q.id === "photo" ? { ...q, required: true } : q,
        ),
      }
    : base;
  await store.saveClient(client);
  const engine = createMissedCallEngine({
    store,
    sms,
    clock: { now: () => NOW },
  });
  const start = await engine.handleCallEvent({
    clientAccountId: client.id,
    callerE164: CALLER,
    answered: false,
    abandoned: false,
    calledAt: NOW,
  });
  const say = (body: string, mediaUrls?: string[]) =>
    engine.handleInboundSms({
      fromE164: CALLER,
      toE164: client.smsFromNumber,
      body,
      mediaUrls,
    });
  await say(options.language ?? "EN");
  await say("Marie Tremblay");
  await say("123 Main St, Laval");
  await say("Leaking kitchen sink");
  const wf = await store.getWorkflow(start.workflow!.id);
  assert.equal(wf?.currentStep, "photo", "setup: the photo question is next");
  return { store, sms, client, engine, say, workflowId: start.workflow!.id };
}

const toCustomer = (sms: ReturnType<typeof createMemorySmsPort>) =>
  sms.sent.filter((m) => m.toE164 === CALLER).map((m) => m.body);

describe("standard SMS (no media) completes the conversation", () => {
  for (const text of [
    "No thanks",
    "Non merci",
    "pas de photo",
    "I don't have one",
    "nope",
    "No",
  ]) {
    it(`"${text}" at the optional photo question moves on without asking for MMS`, async () => {
      const { store, sms, say, workflowId } = await atPhotoStep();
      const result = await say(text);
      assert.equal(result.handled, true);
      const wf = await store.getWorkflow(workflowId);
      assert.equal(wf?.status, "awaiting_technician", "intake is complete");
      assert.deepEqual(wf?.collected.photoUrls, []);
      assert.ok(
        !toCustomer(sms).some((b) => /MMS/i.test(b)),
        `no MMS demand: ${JSON.stringify(toCustomer(sms))}`,
      );
    });
  }

  it("a plain 'yes' gets one reminder, then any text moves on", async () => {
    const { store, sms, say, workflowId } = await atPhotoStep();
    await say("yes");
    assert.equal(
      (await store.getWorkflow(workflowId))?.currentStep,
      "photo",
      "waits for the photo it was promised",
    );
    assert.match(toCustomer(sms).at(-1) ?? "", /send it whenever you're ready/i);

    await say("ok");
    const wf = await store.getWorkflow(workflowId);
    assert.equal(wf?.status, "awaiting_technician", "never asked a second time");
    assert.equal(
      toCustomer(sms).filter((b) => /send it whenever/i.test(b)).length,
      1,
    );
  });

  it("useful text typed instead of a photo is kept with the request", async () => {
    const { store, say, workflowId } = await atPhotoStep();
    await say("The pipe under the sink has been dripping for 3 days");
    const wf = await store.getWorkflow(workflowId);
    assert.equal(wf?.status, "awaiting_technician");
    assert.match(
      wf?.collected.issueDescription ?? "",
      /Leaking kitchen sink — The pipe under the sink/,
    );
  });

  it("French customers are never told to send an MMS either", async () => {
    const { store, sms, say, workflowId } = await atPhotoStep({ language: "FR" });
    await say("Non, je n'en ai pas");
    assert.equal(
      (await store.getWorkflow(workflowId))?.status,
      "awaiting_technician",
    );
    assert.ok(!toCustomer(sms).some((b) => /MMS/i.test(b)));
  });

  it("a photo the contractor made mandatory is still required, for text and for 'no'", async () => {
    const { store, sms, say, workflowId } = await atPhotoStep({
      requirePhoto: true,
    });
    await say("no thanks");
    await say("it is a small leak");
    const wf = await store.getWorkflow(workflowId);
    assert.equal(wf?.currentStep, "photo");
    assert.equal(
      toCustomer(sms).filter((b) => /photo is required/i.test(b)).length,
      2,
      "each text is answered once",
    );
    await say("here", ["https://api.twilio.com/media/ME1"]);
    assert.equal(
      (await store.getWorkflow(workflowId))?.status,
      "awaiting_technician",
    );
  });
});

describe("MMS attachments are used when present", () => {
  it("a photo at the photo question is stored with the request", async () => {
    const { store, say, workflowId } = await atPhotoStep();
    await say("", ["https://api.twilio.com/media/ME_photo_1"]);
    const wf = await store.getWorkflow(workflowId);
    assert.equal(wf?.status, "awaiting_technician");
    assert.deepEqual(wf?.collected.photoUrls, [
      "https://api.twilio.com/media/ME_photo_1",
    ]);
  });

  it("a photo sent alone at another question is kept and the question is asked again, not 'too short'", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => NOW },
    });
    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: CALLER,
      answered: false,
      abandoned: false,
      calledAt: NOW,
    });
    const say = (body: string, mediaUrls?: string[]) =>
      engine.handleInboundSms({
        fromE164: CALLER,
        toE164: client.smsFromNumber,
        body,
        mediaUrls,
      });
    await say("EN");
    await say("Marie Tremblay"); // now at the address question
    await say("", ["https://api.twilio.com/media/ME_early"]);
    const wf = await store.getWorkflow(start.workflow!.id);
    assert.equal(wf?.currentStep, "address", "still waiting for the address");
    assert.deepEqual(wf?.collected.photoUrls, [
      "https://api.twilio.com/media/ME_early",
    ]);
    const last = sms.sent.filter((m) => m.toE164 === CALLER).at(-1)!.body;
    assert.match(last, /service address/i);
    assert.doesNotMatch(last, /too short/i);

    // The photo is already in hand, so the photo question is not asked again.
    await say("12 Main St, Laval");
    await say("Leaking kitchen sink");
    assert.equal(
      (await store.getWorkflow(start.workflow!.id))?.status,
      "awaiting_technician",
    );
  });

  it("SMS and MMS in one conversation keep every message and the photo", async () => {
    const { store, say, workflowId } = await atPhotoStep();
    await say("I'll send a picture");
    await say("", ["https://api.twilio.com/media/ME_mixed"]);
    const wf = await store.getWorkflow(workflowId);
    assert.equal(wf?.status, "awaiting_technician");
    const lead = await store.getLeadByWorkflowId(workflowId);
    const inbound = (lead?.conversation ?? []).filter(
      (c) => c.direction === "inbound",
    );
    // The lead's log starts once the problem is described; both kinds follow in order.
    assert.deepEqual(
      inbound.map((c) => c.body),
      ["I'll send a picture", ""],
    );
    assert.deepEqual(inbound.at(-1)?.mediaUrls, [
      "https://api.twilio.com/media/ME_mixed",
    ]);
  });
});

describe("outbound replies are plain SMS unless a picture is attached on purpose", () => {
  async function sendThrough(message: { mediaUrl?: string }) {
    const requests: URLSearchParams[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requests.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({ sid: "SMsent" }), { status: 201 });
    }) as typeof fetch;
    try {
      const port = createTwilioSmsPort({
        NODE_ENV: "production",
        MISSED_CALL_SMS_MODE: "live",
        TWILIO_ACCOUNT_SID: "ACtest",
        TWILIO_AUTH_TOKEN: "token",
        NEXT_PUBLIC_SITE_URL: "https://tradecatch.test",
      } as unknown as NodeJS.ProcessEnv);
      await port.send({
        toE164: CALLER,
        fromE164: "+14385550100",
        body: "Bonjour",
        internal: true,
        ...message,
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    return requests[0]!;
  }

  it("a text reply has no MediaUrl", async () => {
    const form = await sendThrough({});
    assert.equal(form.get("Body"), "Bonjour");
    assert.equal(form.has("MediaUrl"), false);
  });

  it("a reply with a picture sends it as MMS", async () => {
    const form = await sendThrough({ mediaUrl: "https://tradecatch.test/a.jpg" });
    assert.equal(form.get("MediaUrl"), "https://tradecatch.test/a.jpg");
  });
});

describe("the Twilio webhook accepts SMS and MMS", () => {
  let seq = 0;
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID"] as const;

  before(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    mock.method(console, "warn", () => {});
    mock.method(console, "info", () => {});
  });
  after(() => {
    mock.restoreAll();
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function business() {
    seq += 1;
    const client = demoClientAccount({
      id: `client_mms_${seq}`,
      smsFromNumber: `+1438555${String(3000 + seq)}`,
    });
    const { store } = await ensureMissedCallReady();
    await store.saveClient(client);
    const { organization } = await getSaasStore().createOrganizationWithOwner({
      name: `Mms ${seq}`,
      ownerEmail: `owner${seq}@mms.test`,
      ownerName: "Owner",
      missedCallClientId: client.id,
      accountType: "production",
    });
    return { client, organization };
  }

  function webhook(to: string, form: Record<string, string>) {
    seq += 1;
    return new NextRequest("http://localhost/api/twilio/sms/inbound", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: CALLER,
        To: to,
        MessageSid: `SMmms${seq}`,
        ...form,
      }).toString(),
    });
  }

  it("a text with NumMedia=0, and one with no NumMedia field at all, are stored", async () => {
    const { client, organization } = await business();
    const forms: Record<string, string>[] = [
      { Body: "Bonjour, j'ai une fuite", NumMedia: "0" },
      { Body: "Hello there" },
    ];
    for (const form of forms) {
      assert.equal((await POST(webhook(client.smsFromNumber, form))).status, 200);
    }
    const history = await getCrmService().recentMessagesByPhone(
      organization.id,
      CALLER,
      50,
    );
    assert.deepEqual(
      history.filter((m) => m.direction === "inbound").map((m) => m.body),
      ["Bonjour, j'ai une fuite", "Hello there"],
    );
  });

  it("a photo-only MMS (empty Body) is stored as a message and never fails the job", async () => {
    const { client, organization } = await business();
    const res = await POST(
      webhook(client.smsFromNumber, {
        Body: "",
        NumMedia: "1",
        MediaUrl0: "https://api.twilio.com/media/ME1",
        MediaContentType0: "image/jpeg",
      }),
    );
    assert.equal(res.status, 200);
    const history = await getCrmService().recentMessagesByPhone(
      organization.id,
      CALLER,
      50,
    );
    const inbound = history.filter((m) => m.direction === "inbound");
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0]!.body, "[photo]");
  });
});
