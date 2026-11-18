/**
 * KAN-17: Automations reliability. Each group is named after the acceptance scenario it
 * proves (AUTO-xx). Everything here runs on the in-memory store; the Postgres store has
 * its own file (sms-automation-postgres.test.ts).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SmsDeliveryError, SmsRateLimitError } from "../../src/product/missed-call/twilio";
import {
  AutomationError,
  createAutomationService,
  type OrgSnapshot,
  type QuoteSnapshot,
} from "../../src/product/sms-automation/service";
import { createMemoryAutomationStore, type AutomationStore } from "../../src/product/sms-automation/store";
import type { AutomationType } from "../../src/product/sms-automation/types";

const ORG = "org_a";
const OTHER = "org_b";
const PHONE = "+15145550100";
// Wednesday 10:00 in Toronto (EST).
const T0 = "2026-01-21T15:00:00.000Z";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const orgSnapshot = (id: string): OrgSnapshot => ({
  id,
  name: "Montreal Plumbing Pro",
  status: "active",
  timezone: "America/Toronto",
  localeDefault: "en",
  phoneE164: "+15145551000",
  accountType: "live",
});

type Sent = { to: string; body: string };

type Options = {
  wrapStore?: (store: AutomationStore) => AutomationStore;
  onCustomerMessage?: () => Promise<void>;
};

function build(options: Options = {}) {
  const base = createMemoryAutomationStore();
  const store = options.wrapStore ? options.wrapStore(base) : base;
  const texts: Sent[] = [];
  let calls = 0;
  let clock = new Date(T0);
  const quoteState = new Map<string, string>();
  const openQuotes: QuoteSnapshot[] = [];
  const external = new Set<string>();
  const hooks = {
    /** Runs when the worker asks for the sender number: the last step before the send. */
    beforeSend: undefined as undefined | (() => Promise<void>),
    /** Decides what the provider does on each call (1-based). Default: accept. */
    provider: undefined as undefined | ((call: number) => Promise<void>),
    openQuotesFail: false,
    sendDelayMs: 0,
  };
  const service = createAutomationService({
    store,
    sms: {
      async send(message) {
        calls += 1;
        if (hooks.sendDelayMs) await new Promise((r) => setTimeout(r, hooks.sendDelayMs));
        await hooks.provider?.(calls);
        texts.push({ to: message.toE164, body: message.body });
        return { sid: `SM${texts.length}` };
      },
    },
    now: () => clock,
    smsMode: "live",
    async loadOrg(id) {
      return orgSnapshot(id);
    },
    async smsFrom() {
      await hooks.beforeSend?.();
      return "+15145550000";
    },
    async quoteStatus(_org, threadId) {
      return quoteState.get(threadId) ?? null;
    },
    async listOpenQuotes() {
      if (hooks.openQuotesFail) throw new Error("quote service down");
      return openQuotes;
    },
    async isSuppressedElsewhere(_org, phone) {
      return external.has(phone);
    },
    onCustomerMessage: options.onCustomerMessage
      ? async () => {
          await options.onCustomerMessage!();
        }
      : undefined,
  });
  return {
    service,
    store,
    base,
    texts,
    calls: () => calls,
    quoteState,
    openQuotes,
    external,
    hooks,
    setNow(value: string | Date) {
      clock = new Date(value);
    },
    now: () => clock,
  };
}
type Harness = ReturnType<typeof build>;

async function find(h: Harness, type: AutomationType, org = ORG) {
  return (await h.service.list(org)).find((row) => row.type === type)!;
}

async function enable(h: Harness, type: AutomationType, org = ORG) {
  const row = await find(h, type, org);
  await h.service.activate(org, row.id);
  return row;
}

/** A real (not simulated) quote thread whose reminders are due at once and an hour later. */
async function quoteReminders(h: Harness, thread = "thr_1", sentAt = T0) {
  const row = await find(h, "quote_followup");
  await h.service.update(ORG, row.id, { initialDelayMinutes: 0, secondDelayMinutes: 60, maxAttempts: 2 });
  await h.service.activate(ORG, row.id);
  h.quoteState.set(thread, "active");
  const scheduled = await h.service.scheduleQuoteFollowUps({
    organizationId: ORG,
    threadId: thread,
    phoneE164: PHONE,
    customerName: "Pat",
    quoteSentAt: sentAt,
    simulated: false,
  });
  return { row, scheduled };
}

async function missedCall(h: Harness, callId: string, phone = PHONE, disposition = "missed") {
  return h.service.scheduleMissedCall({
    organizationId: ORG,
    callId,
    callerE164: phone,
    disposition,
    simulated: false,
  });
}

const failingStore =
  (method: string, shouldFail: () => boolean) =>
  (store: AutomationStore): AutomationStore =>
    new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== method || typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          if (shouldFail()) throw new Error("database unavailable");
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      },
    });

let savedKillSwitch: string | undefined;
let savedMaxAge: string | undefined;
before(() => {
  savedKillSwitch = process.env.MISSED_CALL_RECOVERY_SMS;
  savedMaxAge = process.env.MISSED_CALL_RECOVERY_MAX_AGE_MINUTES;
  delete process.env.MISSED_CALL_RECOVERY_SMS;
  delete process.env.MISSED_CALL_RECOVERY_MAX_AGE_MINUTES;
});
after(() => {
  if (savedKillSwitch === undefined) delete process.env.MISSED_CALL_RECOVERY_SMS;
  else process.env.MISSED_CALL_RECOVERY_SMS = savedKillSwitch;
  if (savedMaxAge === undefined) delete process.env.MISSED_CALL_RECOVERY_MAX_AGE_MINUTES;
  else process.env.MISSED_CALL_RECOVERY_MAX_AGE_MINUTES = savedMaxAge;
});

describe("AUTO-01 / AUTO-02: enable and disable", () => {
  it("a new business has every automation off, in a fixed order", async () => {
    const h = build();
    const rows = await h.service.list(ORG);
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.enabled === false));
    assert.deepEqual(
      rows.map((row) => row.type),
      [
        "missed_call_recovery",
        "quote_followup",
        "appointment_reminder",
        "customer_reengagement",
        "urgent_lead_notification",
      ],
    );
  });

  it("enabling stores the switch, and repeating it changes nothing", async () => {
    const h = build();
    const row = await find(h, "missed_call_recovery");
    const first = await h.service.activate(ORG, row.id);
    assert.equal(first.enabled, true);
    const again = await h.service.activate(ORG, row.id);
    assert.equal(again.enabled, true);
    assert.equal((await find(h, "missed_call_recovery")).enabled, true);
  });

  it("disabling cancels what was waiting, stays off, and repeating it is harmless", async () => {
    const h = build();
    const row = await enable(h, "missed_call_recovery");
    await missedCall(h, "call_1");
    const stopped = await h.service.deactivate(ORG, row.id);
    assert.equal(stopped.automation.enabled, false);
    assert.equal(stopped.canceled, 1);
    const again = await h.service.deactivate(ORG, row.id);
    assert.equal(again.automation.enabled, false);
    assert.equal(again.canceled, 0);
    h.setNow(new Date(Date.parse(T0) + 5 * MIN));
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 0);
  });

  it("a text queued before the switch was turned off is not sent if it slips through", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_slip");
    // The switch is flipped directly, so the pending job is NOT canceled: the worker's own
    // check is the only thing between the queue and the customer.
    const row = await find(h, "missed_call_recovery");
    await h.base.setAutomationEnabled(ORG, row.id, false, T0);
    h.setNow(new Date(Date.parse(T0) + 5 * MIN));
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.status, "canceled");
    assert.equal(ran.jobs[0]?.cancelReason, "automation_disabled");
    assert.equal(h.texts.length, 0);
  });

  it("turning it back on revives reminders that were canceled only because it was off", async () => {
    const h = build();
    const row = await enable(h, "quote_followup");
    h.quoteState.set("thr_open", "active");
    h.openQuotes.push({
      id: "thr_open",
      customerPhoneE164: PHONE,
      customerName: "Pat",
      locale: "en",
      status: "active",
      quoteSentAt: T0,
    });
    await h.service.deactivate(ORG, row.id);
    await h.service.activate(ORG, row.id);
    const jobs = await h.service.listJobs(ORG);
    assert.equal(jobs.length, 2, "revived, not duplicated");
    assert.ok(jobs.every((job) => job.status === "pending"));
  });

  it("only operational automations can be switched on", async () => {
    const h = build();
    const row = await find(h, "customer_reengagement");
    await assert.rejects(
      () => h.service.activate(ORG, row.id),
      (err: unknown) => err instanceof AutomationError && err.status === 409,
    );
    assert.equal((await find(h, "customer_reengagement")).enabled, false);
  });
});

describe("AUTO-03: settings survive reloads", () => {
  it("loading the page again, even all at once, never resets a switch or a setting", async () => {
    const h = build();
    const row = await find(h, "quote_followup");
    await h.service.update(ORG, row.id, { initialDelayMinutes: 7 });
    await h.service.activate(ORG, row.id);
    await Promise.all(Array.from({ length: 8 }, () => h.service.list(ORG)));
    await Promise.all(Array.from({ length: 4 }, () => h.service.listTemplates(ORG)));
    const after = await find(h, "quote_followup");
    assert.equal(after.enabled, true);
    assert.equal(after.config.initialDelayMinutes, 7);
    assert.equal((await h.service.list(ORG)).length, 5);
    const templates = await h.service.listTemplates(ORG);
    const keys = templates.map((t) => `${t.templateKey}:${t.locale}`);
    assert.equal(new Set(keys).size, keys.length, "no duplicate templates");
  });

  it("a switch and a save at the same moment both stick", async () => {
    const h = build();
    const row = await find(h, "missed_call_recovery");
    await Promise.all([
      h.service.update(ORG, row.id, { initialDelayMinutes: 9 }),
      h.service.activate(ORG, row.id),
    ]);
    const stored = await find(h, "missed_call_recovery");
    assert.equal(stored.enabled, true);
    assert.equal(stored.config.initialDelayMinutes, 9);
    await Promise.all([
      h.service.deactivate(ORG, row.id),
      h.service.update(ORG, row.id, { initialDelayMinutes: 11 }),
    ]);
    const final = await find(h, "missed_call_recovery");
    assert.equal(final.enabled, false);
    assert.equal(final.config.initialDelayMinutes, 11);
  });

  it("settings are kept per business", async () => {
    const h = build();
    const a = await find(h, "missed_call_recovery", ORG);
    const b = await find(h, "missed_call_recovery", OTHER);
    await h.service.update(ORG, a.id, { initialDelayMinutes: 15 });
    await h.service.activate(ORG, a.id);
    const untouched = await find(h, "missed_call_recovery", OTHER);
    assert.equal(untouched.id, b.id);
    assert.equal(untouched.enabled, false);
    assert.equal(untouched.config.initialDelayMinutes, 2);
  });

  it("an invalid setting is refused with the setting named, and nothing is stored", async () => {
    const h = build();
    const row = await find(h, "quote_followup");
    await assert.rejects(
      () => h.service.update(ORG, row.id, { maxAttempts: 9 }),
      (err: unknown) =>
        err instanceof AutomationError && err.status === 400 && err.fields.includes("max_attempts"),
    );
    assert.equal((await find(h, "quote_followup")).config.maxAttempts, row.config.maxAttempts);
  });

  it("the message category is not a setting: it cannot be changed to marketing", async () => {
    const h = build();
    const row = await find(h, "missed_call_recovery");
    const saved = await h.service.update(ORG, row.id, { messageCategory: "marketing" } as never);
    assert.equal(saved.config.messageCategory, "inquiry_response");
    assert.equal((await find(h, "missed_call_recovery")).config.messageCategory, "inquiry_response");
  });

  it("a saved template is the one that is read back", async () => {
    const h = build();
    const templates = await h.service.listTemplates(ORG);
    const target = templates.find((t) => t.templateKey === "missed_call_recovery" && t.locale === "en")!;
    const body = "Hi, this is {{business_name}}. Sorry we missed you! Reply STOP to opt out.";
    await h.service.updateTemplate(ORG, target.id, { body });
    const again = (await h.service.listTemplates(ORG)).find((t) => t.id === target.id)!;
    assert.equal(again.body, body);
    assert.equal(again.customized, true);
    await assert.rejects(
      () => h.service.updateTemplate(ORG, target.id, { body: "No identity, no opt-out" }),
      (err: unknown) => err instanceof AutomationError && err.status === 400,
    );
    assert.equal((await h.service.listTemplates(ORG)).find((t) => t.id === target.id)!.body, body);
  });
});

describe("AUTO-05 / AUTO-06: missed-call recovery", () => {
  it("an eligible missed call gets exactly one recovery text when enabled", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    const scheduled = await missedCall(h, "call_1");
    assert.equal(scheduled.scheduled, true);
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.status, "submitted");
    assert.equal(h.texts.length, 1);
    assert.equal(h.texts[0]!.to, PHONE);
    assert.match(h.texts[0]!.body, /Montreal Plumbing Pro/);
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 1);
  });

  it("nothing is scheduled while the automation is off", async () => {
    const h = build();
    const result = await missedCall(h, "call_off");
    assert.equal(result.scheduled, false);
    h.setNow(new Date(Date.parse(T0) + 10 * MIN));
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 0);
  });

  it("only a call nobody answered qualifies", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    assert.equal((await missedCall(h, "c_answered", PHONE, "answered")).reason, "call_handled");
    assert.equal((await missedCall(h, "c_abandoned", PHONE, "abandoned")).reason, "call_handled");
    assert.equal((await missedCall(h, "c_voicemail", PHONE, "voicemail")).reason, "ineligible");
    assert.equal((await missedCall(h, "", PHONE, "missed")).reason, "ineligible");
    assert.equal((await missedCall(h, "c_anon", "anonymous", "missed")).reason, "ineligible");
    assert.equal((await missedCall(h, "c_short", "12345", "missed")).reason, "ineligible");
    assert.equal((await h.service.listJobs(ORG)).length, 0);
    assert.equal((await missedCall(h, "c_after_hours", PHONE, "after_hours_missed")).scheduled, true);
  });

  it("the same call reported twice is one text, even when the reports race", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    const results = await Promise.all(
      Array.from({ length: 6 }, () => missedCall(h, "call_dup")),
    );
    assert.equal(results.filter((r) => r.scheduled).length, 1);
    assert.ok(results.filter((r) => !r.scheduled).every((r) => r.reason === "duplicate"));
    assert.equal((await h.service.listJobs(ORG)).length, 1);
    h.setNow(new Date(Date.parse(T0) + 5 * MIN));
    await h.service.processDue({ organizationId: ORG });
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("a second call from the same caller inside a day is not texted again", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    assert.equal((await missedCall(h, "call_first")).scheduled, true);
    const second = await missedCall(h, "call_second");
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "duplicate");
  });

  it("a number that opted out, here or through the call workflow, is never texted", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    h.external.add("+15145550111");
    assert.equal((await missedCall(h, "call_ext", "+15145550111")).reason, "ineligible");
    await h.service.applyInbound({
      organizationId: ORG,
      fromE164: "+15145550112",
      body: "STOP",
      messageSid: "SM_stop",
    });
    assert.equal((await missedCall(h, "call_stop", "+15145550112")).reason, "ineligible");
    assert.equal((await h.service.listJobs(ORG)).length, 0);
  });

  it("a number that opts out after the text was queued is not texted", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_late_stop");
    h.external.add(PHONE);
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.status, "canceled");
    assert.equal(ran.jobs[0]?.cancelReason, "opted_out");
    assert.equal(h.texts.length, 0);
  });
});

describe("AUTO-07: quote follow-ups stop when the quote is settled", () => {
  const cases: Array<[string, string | null, string]> = [
    ["accepted", "won", "quote_accepted"],
    ["rejected", "lost", "quote_rejected"],
    ["canceled", "stopped", "quote_stopped"],
    ["deleted", null, "quote_not_found"],
  ];
  for (const [label, status, reason] of cases) {
    it(`no reminder goes out for a quote that was ${label}`, async () => {
      const h = build();
      await quoteReminders(h);
      if (status === null) h.quoteState.delete("thr_1");
      else h.quoteState.set("thr_1", status);
      h.setNow(new Date(Date.parse(T0) + 2 * HOUR));
      const ran = await h.service.processDue({ organizationId: ORG });
      assert.equal(ran.processed, 2);
      assert.ok(ran.jobs.every((job) => job.status === "canceled" && job.cancelReason === reason));
      assert.equal(h.texts.length, 0);
    });
  }

  it("a quote settled after the first reminder stops the second", async () => {
    const h = build();
    await quoteReminders(h);
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
    h.quoteState.set("thr_1", "won");
    h.setNow(new Date(Date.parse(T0) + 90 * MIN));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
    const history = await h.service.history(ORG);
    assert.ok(history.some((row) => row.cancelReason === "quote_accepted"));
  });

  it("recording the outcome cancels what is queued at once", async () => {
    const h = build();
    await quoteReminders(h);
    await h.service.setQuoteOutcome(ORG, "thr_1", "rejected");
    h.setNow(new Date(Date.parse(T0) + 2 * HOUR));
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 0);
  });

  it("a customer who opted out is not reminded", async () => {
    const h = build();
    await quoteReminders(h);
    h.external.add(PHONE);
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.ok(ran.jobs.every((job) => job.cancelReason === "opted_out"));
    assert.equal(h.texts.length, 0);
  });
});

describe("quote follow-up scheduling", () => {
  it("scheduling the same quote again makes no extra reminders", async () => {
    const h = build();
    const { row } = await quoteReminders(h);
    await h.service.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_1",
      phoneE164: PHONE,
      quoteSentAt: T0,
    });
    await h.service.activate(ORG, row.id);
    assert.equal((await h.service.listJobs(ORG)).length, 2);
  });

  it("enabling the automation schedules the open quotes once, and skips settled ones", async () => {
    const h = build();
    h.openQuotes.push(
      { id: "thr_a", customerPhoneE164: PHONE, locale: "en", status: "active", quoteSentAt: T0 },
      { id: "thr_b", customerPhoneE164: "+15145550113", locale: "en", status: "won", quoteSentAt: T0 },
    );
    const row = await find(h, "quote_followup");
    await h.service.activate(ORG, row.id);
    await h.service.activate(ORG, row.id);
    const jobs = await h.service.listJobs(ORG);
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((job) => job.payload.quoteThreadId === "thr_a"));
  });

  it("an old quote does not get every missed reminder at once", async () => {
    const h = build();
    // Defaults: reminders 1 day and 5 days after the quote. Sent 6 days ago: both are late.
    const row = await find(h, "quote_followup");
    await h.service.activate(ORG, row.id);
    h.quoteState.set("thr_old", "active");
    const sent = new Date(Date.parse(T0) - 6 * DAY).toISOString();
    const result = await h.service.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_old",
      phoneE164: PHONE,
      quoteSentAt: sent,
    });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]!.payload.attemptIndex, 2);
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("a quote from long ago gets no reminder at all", async () => {
    const h = build();
    const row = await find(h, "quote_followup");
    await h.service.activate(ORG, row.id);
    const sent = new Date(Date.parse(T0) - 40 * DAY).toISOString();
    const result = await h.service.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_ancient",
      phoneE164: PHONE,
      quoteSentAt: sent,
    });
    assert.equal(result.jobs.length, 0);
  });

  it("an unreadable send time does not produce reminders at an invalid time", async () => {
    const h = build();
    const row = await find(h, "quote_followup");
    await h.service.activate(ORG, row.id);
    const result = await h.service.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_garbage",
      phoneE164: PHONE,
      quoteSentAt: "not a date",
    });
    assert.ok(result.jobs.length > 0);
    assert.ok(result.jobs.every((job) => Number.isFinite(Date.parse(job.scheduledAt))));
  });
});

describe("AUTO-08: a scheduled reminder runs once, at the right time", () => {
  it("is not sent early, is sent once when due, and the next step waits for its own time", async () => {
    const h = build();
    const row = await find(h, "quote_followup");
    await h.service.activate(ORG, row.id);
    h.quoteState.set("thr_t", "active");
    const result = await h.service.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_t",
      phoneE164: PHONE,
      customerName: "Pat",
      quoteSentAt: T0,
    });
    // One day after the quote, 10:00 Toronto, and five days after it.
    assert.equal(result.jobs[0]!.scheduledAt, "2026-01-22T15:00:00.000Z");
    assert.equal(result.jobs[1]!.scheduledAt, "2026-01-26T15:00:00.000Z");

    h.setNow("2026-01-22T14:59:00.000Z");
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 0);

    h.setNow("2026-01-22T15:00:00.000Z");
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 1);
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    h.setNow("2026-01-22T20:00:00.000Z");
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 1);

    h.setNow("2026-01-26T15:00:00.000Z");
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 1);
    assert.equal(h.texts.length, 2);
    assert.notEqual(h.texts[0]!.body, h.texts[1]!.body);
    h.setNow("2026-02-20T15:00:00.000Z");
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 2);
  });

  it("a reminder that comes due at night waits for the business's morning, then sends once", async () => {
    const h = build();
    const row = await find(h, "quote_followup");
    await h.service.update(ORG, row.id, { initialDelayMinutes: 0, secondDelayMinutes: 60, maxAttempts: 1 });
    await h.service.activate(ORG, row.id);
    h.quoteState.set("thr_n", "active");
    h.setNow("2026-01-22T00:30:00.000Z"); // 19:30 Toronto, inside the 8-20 window
    await h.service.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_n",
      phoneE164: PHONE,
      quoteSentAt: "2026-01-22T00:30:00.000Z",
    });
    h.setNow("2026-01-22T03:00:00.000Z"); // 22:00 Toronto, the worker is late
    const night = await h.service.processDue({ organizationId: ORG });
    assert.equal(night.jobs[0]?.status, "pending");
    assert.equal(night.jobs[0]?.scheduledAt, "2026-01-22T13:00:00.000Z");
    assert.equal(h.texts.length, 0);
    h.setNow("2026-01-22T13:00:00.000Z");
    await h.service.processDue({ organizationId: ORG });
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });
});

describe("AUTO-09: quiet hours and consent", () => {
  it("with quiet hours on, a call missed at night gets no text, not a late one", async () => {
    const h = build();
    const row = await find(h, "missed_call_recovery");
    await h.service.update(ORG, row.id, { respectQuietHours: true });
    await h.service.activate(ORG, row.id);
    h.setNow("2026-01-22T03:00:00.000Z"); // 22:00 Toronto
    await missedCall(h, "call_night", PHONE, "after_hours_missed");
    h.setNow("2026-01-22T03:03:00.000Z");
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.status, "skipped");
    assert.equal(ran.jobs[0]?.cancelReason, "quiet_hours");
    assert.equal(h.texts.length, 0);
    h.setNow("2026-01-22T13:30:00.000Z");
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.texts.length, 0);
  });

  it("with quiet hours on, a call missed during the day still gets its text", async () => {
    const h = build();
    const row = await find(h, "missed_call_recovery");
    await h.service.update(ORG, row.id, { respectQuietHours: true });
    await h.service.activate(ORG, row.id);
    await missedCall(h, "call_day");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("by default the text of a night call is not held back", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    h.setNow("2026-01-22T03:00:00.000Z");
    await missedCall(h, "call_night_default", PHONE, "after_hours_missed");
    h.setNow("2026-01-22T03:03:00.000Z");
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("a job without recorded consent is skipped, never sent", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_no_consent");
    const [job] = await h.store.listJobs(ORG, 10);
    delete job!.payload.consentId;
    await h.store.saveJob(job!);
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.status, "skipped");
    assert.equal(ran.jobs[0]?.cancelReason, "legal_basis");
    assert.equal(h.texts.length, 0);
  });

  it("a business that is not active sends nothing", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_inactive");
    const service = createAutomationService({
      store: h.store,
      sms: { send: async () => ({ sid: "SMx" }) },
      now: () => new Date(Date.parse(T0) + 5 * MIN),
      smsMode: "live",
      async loadOrg(id) {
        return { ...orgSnapshot(id), status: "suspended" };
      },
      async smsFrom() {
        return "+15145550000";
      },
    });
    const ran = await service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.cancelReason, "business_inactive");
    assert.equal(h.texts.length, 0);
  });
});

describe("AUTO-10: a failure is visible, never a false success", () => {
  it("a database failure while enabling is raised and the switch stays off", async () => {
    let down = false;
    const h = build({ wrapStore: failingStore("setAutomationEnabled", () => down) });
    const row = await find(h, "missed_call_recovery");
    down = true;
    await assert.rejects(() => h.service.activate(ORG, row.id), /database unavailable/);
    down = false;
    assert.equal((await find(h, "missed_call_recovery")).enabled, false);
  });

  it("a database failure while disabling is raised and the switch stays on", async () => {
    let down = false;
    const h = build({ wrapStore: failingStore("setAutomationEnabled", () => down) });
    const row = await enable(h, "missed_call_recovery");
    down = true;
    await assert.rejects(() => h.service.deactivate(ORG, row.id), /database unavailable/);
    down = false;
    assert.equal((await find(h, "missed_call_recovery")).enabled, true);
  });

  it("a database failure while saving is raised and nothing is stored", async () => {
    let down = false;
    const h = build({ wrapStore: failingStore("updateAutomationConfig", () => down) });
    const row = await find(h, "quote_followup");
    down = true;
    await assert.rejects(() => h.service.update(ORG, row.id, { initialDelayMinutes: 42 }), /database unavailable/);
    down = false;
    assert.equal((await find(h, "quote_followup")).config.initialDelayMinutes, row.config.initialDelayMinutes);
  });

  it("if open quotes cannot be scheduled, the automation is not left half on", async () => {
    const h = build();
    h.openQuotes.push({ id: "thr_x", customerPhoneE164: PHONE, locale: "en", status: "active", quoteSentAt: T0 });
    h.hooks.openQuotesFail = true;
    const row = await find(h, "quote_followup");
    await assert.rejects(() => h.service.activate(ORG, row.id), /quote service down/);
    assert.equal((await find(h, "quote_followup")).enabled, false);
    h.hooks.openQuotesFail = false;
    assert.equal((await h.service.activate(ORG, row.id)).enabled, true);
  });

  it("a failed send is recorded as a failure in the log and counted, never as a success", async () => {
    const h = build();
    h.hooks.provider = async () => {
      throw new SmsDeliveryError("dead", "invalid_number");
    };
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_dead");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await h.service.processDue({ organizationId: ORG });
    const executions = await h.service.executions(ORG);
    assert.equal(executions.length, 1);
    assert.equal(executions[0]!.status, "failure");
    assert.equal(executions[0]!.result, "failed");
    const automation = await find(h, "missed_call_recovery");
    assert.equal(automation.failureCount, 1);
    assert.equal(automation.successCount, 0);
    assert.equal(automation.lastExecutionStatus, "failed");
  });

  it("a delivered text is logged with its time and counted once", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_ok");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await h.service.processDue({ organizationId: ORG });
    const executions = await h.service.executions(ORG);
    assert.equal(executions.length, 1);
    assert.equal(executions[0]!.status, "success");
    assert.equal(executions[0]!.at, new Date(Date.parse(T0) + 3 * MIN).toISOString());
    const automation = await find(h, "missed_call_recovery");
    assert.equal(automation.successCount, 1);
    assert.equal(automation.failureCount, 0);
  });

  it("the execution log of one business is not visible to another", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_scoped");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await h.service.processDue({ organizationId: ORG });
    assert.equal((await h.service.executions(OTHER)).length, 0);
    assert.equal((await h.service.history(OTHER)).length, 0);
    assert.equal((await h.service.listJobs(OTHER)).length, 0);
  });
});

describe("AUTO-11: concurrent workers", () => {
  it("many workers racing for one job send exactly one text", async () => {
    const h = build();
    h.hooks.sendDelayMs = 5;
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_race");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await Promise.all(Array.from({ length: 8 }, () => h.service.processDue({ organizationId: ORG })));
    assert.equal(h.texts.length, 1);
    assert.equal(h.calls(), 1);
  });

  it("several workers share a queue without sending anything twice", async () => {
    const h = build();
    h.hooks.sendDelayMs = 3;
    await enable(h, "missed_call_recovery");
    for (let i = 0; i < 6; i++) await missedCall(h, `call_${i}`, `+1514555020${i}`);
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await Promise.all(Array.from({ length: 4 }, () => h.service.processDue({ organizationId: ORG })));
    assert.equal(h.texts.length, 6);
    assert.equal(new Set(h.texts.map((t) => t.to)).size, 6);
    const jobs = await h.service.listJobs(ORG);
    assert.ok(jobs.every((job) => job.status === "submitted"));
  });

  it("a worker that died before sending has its job released after ten minutes, and it is sent once", async () => {
    const h = build();
    await quoteReminders(h);
    const claimed = await h.base.claimNext({ nowIso: T0, organizationId: ORG });
    assert.ok(claimed);
    // Right after: the other worker finds nothing, the first one is presumed alive.
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    h.setNow(new Date(Date.parse(T0) + 11 * MIN));
    await h.service.processDue({ organizationId: ORG });
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1, "the released step goes out once; the next is not due yet");
    h.setNow(new Date(Date.parse(T0) + 61 * MIN));
    await h.service.processDue({ organizationId: ORG });
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 2, "each step exactly once");
  });

  it("a worker that died after the send began never causes a second send", async () => {
    const h = build();
    await quoteReminders(h);
    const claimed = await h.base.claimNext({ nowIso: T0, organizationId: ORG });
    assert.ok(claimed);
    assert.equal(await h.base.beginSend(claimed, T0), true);
    h.setNow(new Date(Date.parse(T0) + 11 * MIN));
    await h.service.processDue({ organizationId: ORG });
    const jobs = await h.service.listJobs(ORG);
    const stuck = jobs.find((job) => job.id === claimed.id)!;
    assert.equal(stuck.status, "uncertain");
    assert.equal(h.texts.length, 0, "the step that may already have gone is not sent again");
    h.setNow(new Date(Date.parse(T0) + 61 * MIN));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1, "only the later step, which was never started");
    // Disabling the automation does not erase the flag either.
    await h.service.deactivate(ORG, claimed.automationId);
    assert.equal((await h.service.listJobs(ORG)).find((job) => job.id === claimed.id)!.status, "uncertain");
  });

  it("turning the automation off after a job was claimed stops that job before the provider", async () => {
    const h = build();
    const row = await enable(h, "missed_call_recovery");
    await missedCall(h, "call_race_off");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    h.hooks.beforeSend = async () => {
      h.hooks.beforeSend = undefined;
      await h.service.deactivate(ORG, row.id);
    };
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 0);
    assert.equal(h.calls(), 0);
    const [job] = await h.service.listJobs(ORG);
    assert.equal(job!.status, "canceled");
    assert.equal(job!.cancelReason, "automation_disabled");
  });
});

describe("AUTO-14: failed executions recover safely", () => {
  async function ready(h: Harness) {
    const row = await find(h, "missed_call_recovery");
    await h.service.update(ORG, row.id, { initialDelayMinutes: 0 });
    await h.service.activate(ORG, row.id);
    await missedCall(h, "call_retry");
    return row;
  }

  it("a temporary failure waits, backs off, and then sends exactly once", async () => {
    const h = build();
    h.hooks.provider = async (call) => {
      if (call <= 2) throw new SmsDeliveryError("retry", "http_503");
    };
    await ready(h);
    const first = await h.service.processDue({ organizationId: ORG });
    assert.equal(first.jobs[0]?.status, "pending");
    assert.equal(first.jobs[0]?.attempts, 1);
    const firstWait = Date.parse(first.jobs[0]!.scheduledAt) - h.now().getTime();
    assert.ok(firstWait >= MIN && firstWait <= 2 * MIN, `first wait ${firstWait}`);
    // Too early: nothing is sent, and the provider is not even called.
    assert.equal((await h.service.processDue({ organizationId: ORG })).processed, 0);
    assert.equal(h.calls(), 1);

    h.setNow(new Date(h.now().getTime() + 2 * MIN));
    const second = await h.service.processDue({ organizationId: ORG });
    assert.equal(second.jobs[0]?.status, "pending");
    const secondWait = Date.parse(second.jobs[0]!.scheduledAt) - h.now().getTime();
    assert.ok(secondWait >= 5 * MIN, `the wait grows: ${secondWait}`);

    h.setNow(new Date(h.now().getTime() + 7 * MIN));
    const third = await h.service.processDue({ organizationId: ORG });
    assert.equal(third.jobs[0]?.status, "submitted");
    assert.equal(h.texts.length, 1);
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("gives up after three attempts, flags it failed, and never counts it as a success", async () => {
    const h = build();
    h.hooks.provider = async () => {
      throw new SmsDeliveryError("retry", "http_503");
    };
    await ready(h);
    for (let i = 0; i < 3; i++) {
      await h.service.processDue({ organizationId: ORG });
      h.setNow(new Date(h.now().getTime() + 30 * MIN));
    }
    const [job] = await h.service.listJobs(ORG);
    assert.equal(job!.status, "failed");
    assert.equal(job!.attempts, 3);
    assert.equal(h.texts.length, 0);
    assert.equal((await find(h, "missed_call_recovery")).successCount, 0);
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.calls(), 3);
  });

  it("a permanent failure is not retried", async () => {
    const h = build();
    h.hooks.provider = async () => {
      throw new SmsDeliveryError("dead", "invalid_number");
    };
    await ready(h);
    await h.service.processDue({ organizationId: ORG });
    h.setNow(new Date(h.now().getTime() + HOUR));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.calls(), 1);
    assert.equal((await h.service.listJobs(ORG))[0]!.status, "failed");
  });

  it("a provider rate limit retries only after the limit resets", async () => {
    const h = build();
    const resetAt = Date.parse(T0) + 30 * MIN;
    h.hooks.provider = async (call) => {
      if (call === 1) throw new SmsRateLimitError(resetAt);
    };
    await ready(h);
    const first = await h.service.processDue({ organizationId: ORG });
    assert.equal(first.jobs[0]?.status, "pending");
    assert.ok(Date.parse(first.jobs[0]!.scheduledAt) >= resetAt);
    h.setNow(new Date(resetAt + MIN));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("an unclassified failure (a timeout) is flagged for a person and never resent", async () => {
    const h = build();
    h.hooks.provider = async () => {
      throw new Error("The operation was aborted due to timeout");
    };
    await ready(h);
    await h.service.processDue({ organizationId: ORG });
    h.setNow(new Date(h.now().getTime() + DAY));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.calls(), 1);
    const [job] = await h.service.listJobs(ORG);
    assert.equal(job!.status, "uncertain");
    assert.equal(job!.lastError, "send_outcome_unknown", "no provider text is kept");
    assert.equal((await h.service.executions(ORG))[0]!.status, "failure");
  });

  it("if the database fails right after the send, the text is never sent a second time", async () => {
    let down = false;
    const h = build({
      wrapStore: (store) =>
        new Proxy(store, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop !== "saveJob" || typeof value !== "function") return value;
            return async (job: { status: string }) => {
              if (down && job.status === "submitted") throw new Error("database unavailable");
              return (value as (j: unknown) => unknown)(job);
            };
          },
        }),
    });
    await ready(h);
    h.hooks.provider = async () => {
      down = true;
    };
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
    down = false;
    h.setNow(new Date(h.now().getTime() + 11 * MIN));
    await h.service.processDue({ organizationId: ORG });
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1, "no second text");
    const [job] = await h.service.listJobs(ORG);
    assert.equal(job!.status, "uncertain", "left for a person, not silently marked a success");
  });

  it("bookkeeping that fails after a delivered text does not undo or repeat it", async () => {
    let logDown = false;
    const h = build({
      wrapStore: failingStore("addExecution", () => logDown),
      onCustomerMessage: async () => {
        throw new Error("crm down");
      },
    });
    await ready(h);
    logDown = true;
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.jobs[0]?.status, "submitted");
    assert.equal(h.texts.length, 1);
    logDown = false;
    h.setNow(new Date(h.now().getTime() + HOUR));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 1);
  });

  it("one job that errors does not stop the others, and is retried later", async () => {
    let failOnce = true;
    const h = build({
      wrapStore: failingStore("getTemplate", () => {
        if (!failOnce) return false;
        failOnce = false;
        return true;
      }),
    });
    const row = await find(h, "missed_call_recovery");
    await h.service.update(ORG, row.id, { initialDelayMinutes: 0 });
    await h.service.activate(ORG, row.id);
    await missedCall(h, "call_a", "+15145550301");
    await missedCall(h, "call_b", "+15145550302");
    const ran = await h.service.processDue({ organizationId: ORG });
    assert.equal(ran.processed, 2);
    assert.equal(h.texts.length, 1);
    const jobs = await h.service.listJobs(ORG);
    const retrying = jobs.find((job) => job.status === "pending")!;
    assert.equal(retrying.attempts, 1);
    assert.match(retrying.lastError ?? "", /unexpected_error/);
    h.setNow(new Date(h.now().getTime() + 5 * MIN));
    await h.service.processDue({ organizationId: ORG });
    assert.equal(h.texts.length, 2);
    assert.equal(new Set(h.texts.map((t) => t.to)).size, 2);
  });
});

describe("delivery callbacks", () => {
  it("a callback that arrives before the job knows its sid is not consumed", async () => {
    const h = build();
    const early = await h.service.applyDeliveryStatus({
      providerSid: "SM1",
      providerStatus: "delivered",
      eventId: "evt_1",
    });
    assert.equal(early.job, null);
    assert.equal(early.duplicate, false);
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_cb");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await h.service.processDue({ organizationId: ORG });
    // The provider retries the same event, now the job exists.
    const retry = await h.service.applyDeliveryStatus({
      providerSid: "SM1",
      providerStatus: "delivered",
      eventId: "evt_1",
    });
    assert.equal(retry.duplicate, false);
    assert.equal(retry.job?.status, "delivered");
  });

  it("the same callback delivered twice is applied once", async () => {
    const h = build();
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_cb2");
    h.setNow(new Date(Date.parse(T0) + 3 * MIN));
    await h.service.processDue({ organizationId: ORG });
    const first = await h.service.applyDeliveryStatus({ providerSid: "SM1", providerStatus: "delivered", eventId: "evt_9" });
    const second = await h.service.applyDeliveryStatus({ providerSid: "SM1", providerStatus: "delivered", eventId: "evt_9" });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
  });
});

describe("AUTO-12: one business cannot touch another's automations", () => {
  it("another business's automation id is not found, whatever the action", async () => {
    const h = build();
    const mine = await find(h, "missed_call_recovery", ORG);
    await h.service.list(OTHER);
    for (const act of [
      () => h.service.activate(OTHER, mine.id),
      () => h.service.deactivate(OTHER, mine.id),
      () => h.service.update(OTHER, mine.id, { initialDelayMinutes: 30 }),
    ]) {
      await assert.rejects(act, (err: unknown) => err instanceof AutomationError && err.status === 404);
    }
    const after = await find(h, "missed_call_recovery", ORG);
    assert.equal(after.enabled, false);
    assert.equal(after.config.initialDelayMinutes, 2);
  });

  it("another business's template and job ids are not found either", async () => {
    const h = build();
    const [template] = await h.service.listTemplates(ORG);
    await h.service.listTemplates(OTHER);
    await assert.rejects(
      () => h.service.updateTemplate(OTHER, template!.id, { reset: true }),
      (err: unknown) => err instanceof AutomationError && err.status === 404,
    );
    await enable(h, "missed_call_recovery");
    await missedCall(h, "call_scope");
    const [job] = await h.service.listJobs(ORG);
    await assert.rejects(
      () => h.service.cancelJob(OTHER, job!.id),
      (err: unknown) => err instanceof AutomationError && err.status === 404,
    );
    assert.equal((await h.service.listJobs(ORG))[0]!.status, "pending");
  });
});
