import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessNotifyInput } from "../../src/lib/business-notifications";
import {
  createAgentCallService,
  type AgentReportInput,
} from "../../src/product/receptionist/agent-calls";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import {
  parseReceptionistConfig,
  validateReceptionistConfig,
} from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import {
  createNotificationRetryJob,
  MAX_NOTIFICATION_ATTEMPTS,
} from "../../src/product/receptionist/notification-retry";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import {
  dashboardCallUrl,
  formatDuration,
  formatPhone,
} from "../../src/product/receptionist/owner-call-alert";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";
import {
  createMemorySmsPort,
  SmsDeliveryError,
} from "../../src/product/missed-call/twilio";
import type { OutboundSms, SmsPort } from "../../src/product/missed-call/types";

const NOW = new Date("2026-11-08T15:00:00Z");
const CALLER = "+15145550123";
const OWNER_SMS = "+15145550304";
const OWNER_EMAIL = "owner@plomberie-test.ca";

function makeConfig(over: Record<string, unknown> = {}): ReceptionistConfig {
  return parseReceptionistConfig({
    id: "rc_notify",
    clientAccountId: "client_notify",
    phoneNumberE164: "+15145550000",
    businessName: "Plomberie Test",
    languages: ["fr", "en"],
    defaultLanguage: "en",
    notifications: [
      { type: "sms", toE164: OWNER_SMS },
      { type: "email", to: OWNER_EMAIL },
    ],
    ...over,
  });
}

type Harness = ReturnType<typeof harness>;
function harness(
  opts: {
    config?: ReceptionistConfig;
    sms?: SmsPort;
    sendEmail?: (i: BusinessNotifyInput) => Promise<{ sent: boolean; reason?: string }>;
  } = {},
) {
  const config = opts.config ?? makeConfig();
  const store = createMemoryReceptionistStore();
  const memorySms = createMemorySmsPort();
  const sms = opts.sms ?? memorySms;
  const emails: BusinessNotifyInput[] = [];
  const sendEmail =
    opts.sendEmail ??
    (async (input: BusinessNotifyInput) => {
      emails.push(input);
      return { sent: true };
    });
  const clock = { now: () => NOW };
  const notifier = createReceptionistNotifier({ sms, sendEmail, clock: clock.now });
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier,
    clock,
  });
  const service = createAgentCallService({ store, finalize: engine.finalizeSession, clock });
  return { config, store, memorySms, emails, notifier, service, clock };
}

const REPORT: AgentReportInput = {
  callId: "call-notify-0001",
  fromE164: CALLER,
  language: "en" as const,
  intent: "service_request" as const,
  slots: {
    callerName: "John Smith",
    callbackE164: CALLER,
    service: "Plumbing",
    issue: "Kitchen pipe leaking",
    serviceAddress: "12 Rue des Pins, Laval",
  },
  transcript: [
    { speaker: "caller" as const, text: "My kitchen pipe is leaking, secret-transcript-text" },
    { speaker: "agent" as const, text: "I have noted that." },
  ],
  durationSeconds: 126,
  endReason: "caller_hung_up" as const,
};

async function finishedCall(h: Harness, over: Partial<AgentReportInput> = {}) {
  const session = await h.service.report(h.config, { ...REPORT, ...over });
  assert.ok(session?.finalizedAt, "the call is finalized");
  return session;
}

describe("owner SMS after a call", () => {
  it("is short, factual and links to the dashboard", async () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://tradecatch.ca";
    try {
      const h = harness();
      const session = await finishedCall(h);
      const text = h.memorySms.sent[0]!;
      assert.equal(text.toE164, OWNER_SMS);
      assert.equal(text.internal, true);
      assert.equal(
        text.body,
        [
          "TradeCatch | New Call",
          "Customer: John Smith",
          "Phone: +1 514-555-0123",
          "Service: Plumbing",
          "Issue: Kitchen pipe leaking",
          "Duration: 2m 06s",
          "Status: Callback needed",
          `Details: https://tradecatch.ca/app/receptionist?call=${session.id}`,
        ].join("\n"),
      );
      assert.doesNotMatch(text.body, /Rue des Pins|secret-transcript/);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prev;
    }
  });

  it("never invents what the call did not produce", async () => {
    const h = harness();
    await finishedCall(h, { slots: {}, transcript: [], durationSeconds: undefined });
    const body = h.memorySms.sent[0]!.body;
    assert.match(body, /^TradeCatch \| New Call\n/);
    assert.doesNotMatch(body, /Customer:|Service:|Issue:|Duration:|Unknown|undefined/);
    assert.match(body, /Phone: \+1 514-555-0123/);
  });

  it("is written in the owner's language", async () => {
    const h = harness({ config: makeConfig({ defaultLanguage: "fr" }) });
    await finishedCall(h);
    const body = h.memorySms.sent[0]!.body;
    assert.match(body, /^TradeCatch \| Nouvel appel\nClient: John Smith/);
    assert.match(body, /Durée: 2m 06s/);
  });

  it("falls back to a plain pointer when no site URL is configured", () => {
    assert.equal(dashboardCallUrl("en", "rcs_1", {}), undefined);
    assert.equal(dashboardCallUrl("en", "rcs_1", { NEXT_PUBLIC_SITE_URL: "http://evil.example" }), undefined);
    assert.equal(
      dashboardCallUrl("fr", "rcs 1", { NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca/x?y=1" }),
      "https://tradecatch.ca/fr/app/receptionist?call=rcs%201",
    );
  });

  it("formats durations and phone numbers", () => {
    assert.equal(formatDuration(126), "2m 06s");
    assert.equal(formatDuration(45), "45s");
    assert.equal(formatDuration(undefined), undefined);
    assert.equal(formatPhone("+15145550123"), "+1 514-555-0123");
    assert.equal(formatPhone("+442071838750"), "+442071838750");
  });
});

describe("owner email after a call", () => {
  it("carries the call, customer, outcome and summary sections plus a secure link", async () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://tradecatch.ca";
    try {
      const h = harness();
      const session = await finishedCall(h);
      assert.equal(h.emails.length, 1);
      const email = h.emails[0]!;
      assert.equal(email.toEmail, OWNER_EMAIL);
      assert.match(email.subject, /^TradeCatch \| New Customer Call Summary/);
      assert.deepEqual(
        email.sections?.map((s) => s.heading),
        ["Call information", "Customer information", "Call outcome", "Conversation summary"],
      );
      const flat = JSON.stringify(email.sections);
      assert.match(flat, /John Smith/);
      assert.match(flat, /Kitchen pipe leaking/);
      assert.match(flat, /12 Rue des Pins, Laval/);
      assert.doesNotMatch(flat, /secret-transcript/, "no raw transcript in email");
      assert.equal(
        email.ctaUrl,
        `https://tradecatch.ca/app/receptionist?call=${session.id}`,
      );
      assert.match(email.idempotencyKey ?? "", new RegExp(`^rcs-${session.id}-email-`));
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prev;
    }
  });

  function lineValue(email: BusinessNotifyInput, label: string): string | undefined {
    for (const section of email.sections ?? []) {
      const found = section.lines.find((l) => l.label === label);
      if (found) return found.value ?? undefined;
    }
    return undefined;
  }

  it("shows the city when that is all the caller gave, instead of an empty address", async () => {
    const h = harness();
    await finishedCall(h, {
      slots: { ...REPORT.slots, serviceAddress: undefined, location: "Laval" },
    });
    assert.equal(lineValue(h.emails[0]!, "Address"), "Laval");
  });

  it("joins a street address and a separately given city, without repeating the city", async () => {
    const h = harness();
    await finishedCall(h, {
      slots: { ...REPORT.slots, serviceAddress: "12 Rue des Pins", location: "Laval" },
    });
    assert.equal(lineValue(h.emails[0]!, "Address"), "12 Rue des Pins, Laval");

    const again = harness();
    await finishedCall(again, {
      callId: "call-notify-0002",
      slots: { ...REPORT.slots, serviceAddress: "12 Rue des Pins, Laval", location: "Laval" },
    });
    assert.equal(lineValue(again.emails[0]!, "Address"), "12 Rue des Pins, Laval");
  });

  it("gives the owner the caller's email, the project and the appointment time they asked for", async () => {
    const h = harness();
    await finishedCall(h, {
      intent: "appointment",
      slots: {
        ...REPORT.slots,
        project: "Replace the kitchen faucet and check the shut-off valve",
        preferredTime: "Thursday morning",
        email: "john@example.com",
      },
    });
    const email = h.emails[0]!;
    assert.equal(lineValue(email, "Email"), "john@example.com");
    assert.equal(lineValue(email, "Preferred appointment time"), "Thursday morning");
    assert.equal(
      lineValue(email, "Project details"),
      "Replace the kitchen faucet and check the shut-off valve",
    );
    // A preferred time on an appointment call is an appointment request, not "message taken".
    assert.equal(lineValue(email, "Call status"), "Appointment requested");
  });

  it("leaves a detail out when nobody collected it (never an empty or guessed value)", async () => {
    const h = harness();
    await finishedCall(h);
    assert.equal(lineValue(h.emails[0]!, "Email"), undefined);
    assert.equal(lineValue(h.emails[0]!, "Project details"), undefined);
  });
});

describe("delivery records", () => {
  it("records each recipient with a masked address, the attempt and success", async () => {
    const h = harness();
    const session = await finishedCall(h);
    const byChannel = Object.fromEntries(session.notifications.map((n) => [n.channel, n]));
    assert.equal(byChannel.sms?.ok, true);
    assert.equal(byChannel.sms?.to, "•••0304");
    assert.equal(byChannel.email?.to, "o•••@plomberie-test.ca");
    assert.equal(byChannel.sms?.attempt, 1);
    assert.doesNotMatch(JSON.stringify(session.notifications), new RegExp(OWNER_EMAIL));
  });

  it("keeps the call when delivery fails, and says why without leaking the number", async () => {
    const h = harness({
      sms: {
        async send() {
          throw new SmsDeliveryError("dead", "twilio_21211", `invalid ${OWNER_SMS}`);
        },
        async syncOptOut() {
          return { ok: true };
        },
      },
      sendEmail: async () => ({ sent: false, reason: "resend_not_configured" }),
    });
    const session = await finishedCall(h);
    assert.equal(session.status, "completed", "the call record is not undone by delivery");
    const sms = session.notifications.find((n) => n.channel === "sms")!;
    const email = session.notifications.find((n) => n.channel === "email")!;
    assert.deepEqual([sms.ok, sms.retryable, sms.detail], [false, false, "provider_twilio_21211"]);
    assert.deepEqual([email.ok, email.retryable, email.detail], [false, false, "resend_not_configured"]);
    assert.doesNotMatch(JSON.stringify(session.notifications), /5145550304/);
  });

  it("sends nothing when the owner has turned every channel off", async () => {
    const h = harness({ config: makeConfig({ notifications: [] }) });
    const session = await finishedCall(h);
    assert.equal(h.memorySms.sent.length, 0);
    assert.equal(h.emails.length, 0);
    assert.deepEqual(session.notifications, []);
  });

  it("respects emergency-only alerts: routine calls are silent, emergencies are not", async () => {
    const h = harness({ config: makeConfig({ emergencyOnlyAlerts: true }) });
    await finishedCall(h);
    assert.equal(h.memorySms.sent.length, 0);
    assert.equal(h.emails.length, 0);

    const e = harness({ config: makeConfig({ emergencyOnlyAlerts: true }) });
    await finishedCall(e, {
      callId: "call-notify-emergency",
      emergency: true,
      transfer: { targetName: "On call", completed: true },
    });
    assert.equal(e.memorySms.sent.length, 1);
    assert.equal(e.emails.length, 1);
  });

  it("rejects an invalid notification destination before it can be used", () => {
    assert.throws(() =>
      parseReceptionistConfig({
        id: "rc_bad",
        clientAccountId: "c",
        phoneNumberE164: "+15145550000",
        businessName: "X",
        notifications: [{ type: "sms", toE164: "514-555-0304" }],
      }),
    );
    assert.equal(
      validateReceptionistConfig(makeConfig({ notifications: [] })).errors.includes(
        "at least one notification channel is required",
      ),
      true,
      "a business with nowhere to notify is flagged",
    );
  });

  it("states the urgency only when the call established one", async () => {
    const h = harness();
    await finishedCall(h, {
      callId: "call-notify-urgent",
      emergency: true,
      transfer: { targetName: "On call", completed: true },
    });
    assert.match(h.memorySms.sent[0]!.body, /\nUrgency: Emergency\n/);
    assert.match(h.memorySms.sent[0]!.body, /\nStatus: Transferred to a person\n/);
  });

  it("mutes a switched-off channel without invalidating the business or losing the call", async () => {
    const config = makeConfig({ mutedNotificationChannels: ["sms"] });
    assert.equal(validateReceptionistConfig(config).errors.includes("at least one notification channel is required"), false);
    const h = harness({ config });
    const session = await finishedCall(h);
    assert.equal(h.memorySms.sent.length, 0, "no text while SMS is off");
    assert.equal(h.emails.length, 1, "email still goes out");
    assert.deepEqual(session.notifications.map((n) => n.channel), ["email"]);

    const both = harness({ config: makeConfig({ mutedNotificationChannels: ["sms", "email"] }) });
    const recorded = await finishedCall(both);
    assert.equal(recorded.status, "completed", "the call is still recorded");
    assert.equal(both.memorySms.sent.length + both.emails.length, 0);
  });

  it("sends once when the same completed call is reported again", async () => {
    const h = harness();
    await finishedCall(h);
    await finishedCall(h);
    await finishedCall(h);
    assert.equal(h.memorySms.sent.length, 1);
    assert.equal(h.emails.length, 1);
  });
});

describe("retrying failed notifications", () => {
  function flakySms(failures: SmsDeliveryError[]) {
    const sent: OutboundSms[] = [];
    let calls = 0;
    const port: SmsPort = {
      async send(message) {
        calls += 1;
        const failure = failures.shift();
        if (failure) throw failure;
        sent.push(message);
        return { sid: `SM_${calls}` };
      },
      async syncOptOut() {
        return { ok: true };
      },
    };
    return { port, sent, calls: () => calls };
  }

  function jobFor(h: Harness, now: () => Date, config = h.config) {
    return createNotificationRetryJob({
      store: h.store,
      notifier: h.notifier,
      configFor: () => config,
      clock: { now },
    });
  }

  it("retries only the failed recipient, after a delay, and then stops", async () => {
    const sms = flakySms([new SmsDeliveryError("retry", "twilio_20429")]);
    const h = harness({ sms: sms.port });
    const session = await finishedCall(h);
    assert.equal(h.emails.length, 1, "email delivered on the first attempt");
    assert.equal(session.notifications.find((n) => n.channel === "sms")?.retryable, true);

    let at = NOW.getTime();
    const job = jobFor(h, () => new Date(at));
    assert.equal((await job.run()).retried, 0, "not before the backoff elapses");

    at += 3 * 60_000;
    const retry = await job.run();
    assert.deepEqual([retry.retried, retry.delivered, retry.failed], [1, 1, 0]);
    assert.equal(sms.sent.length, 1, "the owner is texted once");
    assert.equal(h.emails.length, 1, "the email that already succeeded is not resent");

    at += 3_600_000;
    assert.equal((await job.run()).retried, 0, "nothing more once delivered");
    const stored = await h.store.getSession(session.id);
    assert.deepEqual(
      stored?.notifications.filter((n) => n.channel === "sms").map((n) => [n.ok, n.attempt]),
      [[false, 1], [true, 2]],
    );
  });

  it("gives up after the attempt limit and keeps the failure for investigation", async () => {
    const failing = Array.from({ length: 10 }, () => new SmsDeliveryError("retry", "twilio_20500"));
    const sms = flakySms(failing);
    const h = harness({ sms: sms.port });
    const session = await finishedCall(h);
    let at = NOW.getTime();
    const job = jobFor(h, () => new Date(at));
    for (let i = 0; i < 8; i += 1) {
      at += 40 * 60_000;
      await job.run();
    }
    assert.equal(sms.calls(), MAX_NOTIFICATION_ATTEMPTS, "first send + three retries, no more");
    const stored = await h.store.getSession(session.id);
    const attempts = stored?.notifications.filter((n) => n.channel === "sms") ?? [];
    assert.equal(attempts.length, MAX_NOTIFICATION_ATTEMPTS);
    assert.ok(attempts.every((n) => !n.ok), "every failed attempt stays on the record");
  });

  it("never resends when the provider's outcome is unknown or the number is refused", async () => {
    for (const disposition of ["uncertain", "dead"] as const) {
      const sms = flakySms([new SmsDeliveryError(disposition, "twilio_x")]);
      const h = harness({ sms: sms.port });
      await finishedCall(h);
      const job = jobFor(h, () => new Date(NOW.getTime() + 3_600_000));
      assert.equal((await job.run()).considered, 0);
      assert.equal(sms.calls(), 1);
    }
  });

  it("lets only one of two overlapping runs send", async () => {
    const sms = flakySms([new SmsDeliveryError("retry", "twilio_20429")]);
    const h = harness({ sms: sms.port });
    await finishedCall(h);
    const later = () => new Date(NOW.getTime() + 3 * 60_000);
    const [a, b] = await Promise.all([jobFor(h, later).run(), jobFor(h, later).run()]);
    assert.equal(a.retried + b.retried, 1);
    assert.equal(sms.sent.length, 1);
  });

  it("does not text a number the owner has since removed", async () => {
    const sms = flakySms([new SmsDeliveryError("retry", "twilio_20429")]);
    const h = harness({ sms: sms.port });
    await finishedCall(h);
    const emailOnly = makeConfig({ notifications: [{ type: "email", to: OWNER_EMAIL }] });
    const job = jobFor(h, () => new Date(NOW.getTime() + 3 * 60_000), emailOnly);
    assert.equal((await job.run()).retried, 0);
    assert.equal(sms.sent.length, 0);
  });
});
