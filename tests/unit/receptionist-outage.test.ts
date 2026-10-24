import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createNotificationTestSchema } from "../support/notification-pg-schema";
import { POST as twilioStep } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import {
  createNotificationService,
  type NoticeMember,
} from "../../src/product/notifications/service";
import {
  createMemoryNotificationStore,
  type NotificationStore,
} from "../../src/product/notifications/store";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import {
  getNotificationService,
  resetNotificationRuntimeForTests,
} from "../../src/product/notifications/runtime";
import {
  OUTAGE_ALERT_WINDOW_MS,
  outageAlertKey,
} from "../../src/product/notifications/hooks";
import {
  defaultPreferences,
  renderNotice,
} from "../../src/product/notifications/templates";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import type { ReceptionistFailure } from "../../src/product/receptionist/engine";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import {
  handleReceptionistFailure,
  type OutageDeps,
} from "../../src/product/receptionist/outage";
import { resetReceptionistRuntimeForTests } from "../../src/product/receptionist/runtime";
import {
  resetSaasRuntimeForTests,
  getSaasStore,
} from "../../src/product/saas/runtime";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

// 2026-10-21 10:00 Toronto, and the same day at 03:00 (deep in quiet hours).
const DAYTIME = Date.parse("2026-10-21T14:00:00Z");
const NIGHT = Date.parse("2026-10-21T07:00:00Z");

function serviceHarness(store: NotificationStore, startAt = DAYTIME) {
  const organizationId = "outage_fixture_" + randomUUID().slice(0, 8);
  let now = startAt;
  const members: NoticeMember[] = [
    {
      userId: "owner",
      phoneE164: "+15145550121",
      phoneVerifiedAt: "2026-01-01T00:00:00Z",
      role: "owner",
      email: "owner@example.test",
      locale: "en",
    },
    {
      userId: "admin_fr",
      phoneE164: "+15145550122",
      phoneVerifiedAt: "2026-01-01T00:00:00Z",
      role: "admin",
      email: "admin@example.test",
      locale: "fr",
    },
    {
      userId: "tech",
      role: "member",
      email: "tech@example.test",
      locale: "en",
    },
    {
      userId: "viewer",
      role: "viewer",
      email: "viewer@example.test",
      locale: "en",
    },
  ];
  const emails: { to: string; subject: string; message: string }[] = [];
  const texts: { to: string; body: string }[] = [];
  const service = createNotificationService({
    store,
    now: () => new Date(now),
    listMembers: async (id) => (id === organizationId ? members : []),
    loadOrg: async (id) =>
      id === organizationId
        ? {
            id,
            name: "Plomberie Nord",
            status: "active",
            timezone: "America/Toronto",
            localeDefault: "en",
            phoneE164: "+15005550006",
            accountType: "production",
          }
        : null,
    sendEmail: async (input) => {
      emails.push(input);
      return { sent: true };
    },
    sendSms: async (input) => {
      texts.push(input);
      return { sent: true, sid: "SM" + randomUUID() };
    },
  });
  async function raise(at = new Date(now)) {
    await service.enqueue({
      organizationId,
      type: "receptionist_offline",
      idempotencyKey: outageAlertKey(organizationId, at),
      payload: { href: "/app/calls" },
    });
    for (let i = 0; i < 4; i++) await service.processDue(25);
  }
  async function noticesFor(userId: string) {
    return (await service.listForUser(organizationId, userId)).filter(
      (row) => row.note.type === "receptionist_offline",
    );
  }
  return {
    service,
    store,
    organizationId,
    emails,
    texts,
    raise,
    noticesFor,
    advance: (minutes: number) => {
      now += minutes * 60_000;
    },
    now: () => new Date(now),
  };
}

function outageChecks(factory: () => NotificationStore) {
  let h: ReturnType<typeof serviceHarness>;
  beforeEach(() => {
    h = serviceHarness(factory());
  });

  it("reaches owners and admins in the app, by email and by SMS, without any setup", async () => {
    await h.raise();
    const owner = await h.noticesFor("owner");
    assert.equal(owner.length, 1);
    assert.equal(owner[0].note.priority, "critical");
    assert.equal(owner[0].note.title, "Receptionist unavailable");
    assert.equal(owner[0].note.href, "/app/calls");

    assert.equal((await h.noticesFor("admin_fr")).length, 1);

    assert.deepEqual(h.emails.map((mail) => mail.to).sort(), [
      "admin@example.test",
      "owner@example.test",
    ]);
    assert.equal(h.texts.length, 2);
    assert.deepEqual(h.texts.map((text) => text.to).sort(), ["+15145550121", "+15145550122"]);
    for (const external of [
      ...h.emails.map((m) => m.message),
      ...h.texts.map((t) => t.body),
    ])
      assert.doesNotMatch(
        external,
        /\bA\.?I\.?\b|\bIA\b/,
        "no AI wording for users",
      );
  });

  it("never alerts staff who cannot act on it", async () => {
    await h.raise();
    assert.equal((await h.noticesFor("tech")).length, 0);
    assert.equal((await h.noticesFor("viewer")).length, 0);
    assert.ok(!h.emails.some((mail) => /tech@|viewer@/.test(mail.to)));
  });

  it("is delivered at night: a critical alert ignores quiet hours", async () => {
    const night = serviceHarness(factory(), NIGHT);
    await night.raise();
    assert.equal(night.emails.length, 2);
    assert.equal(night.texts.length, 2);
  });

  it("lets an owner turn external delivery off, and back on", async () => {
    const prefs = defaultPreferences(
      h.organizationId,
      "owner",
      "en",
      h.now().toISOString(),
    );
    prefs.categories.outages = { inApp: true, email: false, sms: false };
    await h.service.savePreferences(prefs);
    await h.raise();
    assert.deepEqual(
      h.emails.map((mail) => mail.to),
      ["admin@example.test"],
      "only the admin, who kept the default, is emailed",
    );
    assert.equal(h.texts.length, 1);
    assert.equal((await h.noticesFor("owner")).length, 1, "still in the app");

    h.advance(OUTAGE_ALERT_WINDOW_MS / 60_000 + 1);
    prefs.categories.outages = { inApp: true, email: true, sms: true };
    await h.service.savePreferences(prefs);
    await h.raise();
    assert.ok(h.emails.some((mail) => mail.to === "owner@example.test"));
  });

  it("applies the default to preferences saved before outages had their own setting", async () => {
    const stored = defaultPreferences(
      h.organizationId,
      "owner",
      "en",
      h.now().toISOString(),
    );
    delete (stored.categories as Partial<typeof stored.categories>).outages;
    await h.store.savePreferences(stored);
    const loaded = await h.service.getPreferences(
      h.organizationId,
      "owner",
      "en",
    );
    assert.deepEqual(loaded.categories.outages, {
      inApp: true,
      email: true,
      sms: true,
    });
    await h.raise();
    assert.ok(h.emails.some((mail) => mail.to === "owner@example.test"));
  });

  it("sends one alert per window however many callers fail, then reminds", async () => {
    await h.raise();
    await h.raise();
    await Promise.all([h.raise(), h.raise()]);
    h.advance(10);
    await h.raise();
    assert.equal((await h.noticesFor("owner")).length, 1);
    assert.equal(h.emails.length, 2);
    // The failure continues past the window: owners are told again.
    h.advance(OUTAGE_ALERT_WINDOW_MS / 60_000);
    await h.raise();
    assert.equal((await h.noticesFor("owner")).length, 2);
  });

  it("stops escalating an outage once an owner acknowledges it", async () => {
    await h.service.saveEscalation({
      ...(await h.service.getEscalation(h.organizationId)),
      secondaryUserId: "admin_fr",
      delayMinutes: 5,
    });
    await h.raise();
    const owner = (await h.noticesFor("owner"))[0];
    await h.service.acknowledge(h.organizationId, "owner", owner.note.id);
    h.advance(30);
    assert.deepEqual(await h.service.processEscalations(h.now()), {
      escalated: 0,
    });
  });
}

describe("receptionist outage alerts to owners", () => {
  outageChecks(createMemoryNotificationStore);
});

describe("receptionist outage wording", () => {
  it("is plain, actionable and free of AI wording in both languages", () => {
    for (const language of ["en", "fr"] as const) {
      const { title, message } = renderNotice(
        "receptionist_offline",
        language,
        {
          business: "Plomberie Nord",
        },
      );
      assert.ok(title.length > 0 && message.includes("Plomberie Nord"));
      assert.doesNotMatch(`${title} ${message}`, /\bA\.?I\.?\b|\bIA\b/);
    }
    assert.equal(
      renderNotice("receptionist_offline", "fr", { business: "X" }).title,
      "Réceptionniste indisponible",
    );
  });
});

describe("receptionist failure handling", () => {
  function fakeDeps(over: Partial<OutageDeps> = {}) {
    const calls = { recorded: [] as unknown[], alerted: [] as string[] };
    const deps: OutageDeps = {
      findOrganization: async (id) =>
        id === "client_a" ? { id: "org_a", status: "active" } : null,
      record: async (input) => void calls.recorded.push(input),
      alertOwners: async (id) => void calls.alerted.push(id),
      ...over,
    };
    return { deps, calls };
  }
  const failure: ReceptionistFailure = {
    clientAccountId: "client_a",
    operation: "gather",
    errorCode: "AI_SESSION_FAILED",
  };

  it("records the failure for the platform and alerts the business's owners", async () => {
    const { deps, calls } = fakeDeps();
    await handleReceptionistFailure(failure, deps);
    assert.deepEqual(calls.recorded, [
      {
        organizationId: "org_a",
        operation: "gather",
        errorCode: "AI_SESSION_FAILED",
      },
    ]);
    assert.deepEqual(calls.alerted, ["org_a"]);
  });

  it("still alerts owners when platform recording fails, and records when alerting fails", async () => {
    const recordingDown = fakeDeps({
      record: async () => {
        throw new Error("monitoring down");
      },
    });
    await handleReceptionistFailure(failure, recordingDown.deps);
    assert.deepEqual(recordingDown.calls.alerted, ["org_a"]);

    const alertingDown = fakeDeps({
      alertOwners: async () => {
        throw new Error("queue down");
      },
    });
    await handleReceptionistFailure(failure, alertingDown.deps);
    assert.equal(alertingDown.calls.recorded.length, 1);
  });

  it("only records platform-level failures it cannot attribute, and never alerts a suspended business", async () => {
    const unknown = fakeDeps();
    await handleReceptionistFailure(
      { ...failure, clientAccountId: undefined },
      unknown.deps,
    );
    assert.equal(unknown.calls.recorded.length, 1);
    assert.deepEqual(unknown.calls.alerted, []);

    const suspended = fakeDeps({
      findOrganization: async () => ({ id: "org_a", status: "suspended" }),
    });
    await handleReceptionistFailure(failure, suspended.deps);
    assert.deepEqual(suspended.calls.alerted, []);

    const lookupDown = fakeDeps({
      findOrganization: async () => {
        throw new Error("db down");
      },
    });
    await handleReceptionistFailure(failure, lookupDown.deps);
    assert.equal(lookupDown.calls.recorded.length, 1);
  });
});

describe("receptionist engine failure reporting", () => {
  const config = parseReceptionistConfig({
    id: "rc_outage",
    clientAccountId: "client_outage",
    phoneNumberE164: "+14385597001",
    businessName: "Nord Plomberie",
    fallbackTransferE164: "+14385597004",
    notifications: [{ type: "sms", toE164: "+14385597005" }],
  });

  function engineWith(configs: () => (typeof config)[]) {
    const failures: ReceptionistFailure[] = [];
    const store = createMemoryReceptionistStore();
    const engine = createReceptionistEngine({
      store,
      configs,
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
      onFailure: (failure) => void failures.push(failure),
    });
    return { engine, store, failures };
  }

  it("reports a call that could not continue, attributed to the business, and still apologizes", async () => {
    let live = true;
    const { engine, failures } = engineWith(() => (live ? [config] : []));
    const plan = await engine.startCall({
      callSid: "CAfail1",
      fromE164: "+15145559876",
      toE164: "+14385597001",
    });
    // The business's receptionist profile disappears mid-call.
    live = false;
    const next = await engine.handleGather({
      sessionId: plan.sessionId!,
      speech: "bonjour",
    });
    assert.deepEqual(failures, [
      {
        clientAccountId: "client_outage",
        operation: "handle_gather",
        errorCode: "AI_SESSION_FAILED",
      },
    ]);
    assert.ok(next.verbs.some((verb) => verb.verb === "say"));
    assert.ok(
      next.verbs.some((verb) => verb.verb === "dial" || verb.verb === "record"),
    );
  });

  it("does not report calls it chose not to answer", async () => {
    const { engine, failures } = engineWith(() => [config]);
    const plan = await engine.startCall({
      callSid: "CAdeclined",
      fromE164: "+15145559876",
      toE164: "+19995550000",
    });
    assert.ok(plan.verbs.length > 0, "the caller still hears the apology");
    assert.deepEqual(failures, []);
  });

  it("keeps the call going when reporting itself fails", async () => {
    const engine = createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      configs: () => [config],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({ sms: createMemorySmsPort() }),
      onFailure: () => {
        throw new Error("reporter exploded");
      },
    });
    const plan = engine.failSafePlan(config, null);
    assert.ok(plan.verbs.some((verb) => verb.verb === "say"));
  });
});

const KEYS = [
  "NODE_ENV",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_ENABLED",
  "RECEPTIONIST_LLM_PROVIDER",
  "MISSED_CALL_SMS_MODE",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "DATABASE_URL",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "RESEND_API_KEY",
  "ADMIN_ALERT_EMAIL",
] as const;

describe("a receptionist failure on a live call alerts the business", () => {
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  const env = process.env as Record<string, string | undefined>;
  const config = JSON.stringify({
    id: "rc_live_outage",
    clientAccountId: "client_live_outage",
    phoneNumberE164: "+14385597001",
    businessName: "Nord Plomberie",
    fallbackTransferE164: "+14385597004",
    notifications: [{ type: "sms", toE164: "+14385597005" }],
  });

  beforeEach(() => {
    for (const key of KEYS) delete env[key];
    env.NODE_ENV = "test";
    env.RECEPTIONIST_CONFIG_JSON = config;
    env.MISSED_CALL_SMS_MODE = "dry-run";
    env.RECEPTIONIST_LLM_PROVIDER = "none";
    resetReceptionistRuntimeForTests();
    resetSaasRuntimeForTests();
    resetNotificationRuntimeForTests();
  });
  afterEach(() => {
    resetReceptionistRuntimeForTests();
    resetSaasRuntimeForTests();
    resetNotificationRuntimeForTests();
    for (const [key, value] of saved) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });

  function webhook(step: string, params: Record<string, string>, query = "") {
    const url = `https://tradecatch.test/api/twilio/voice/receptionist/${step}${query}`;
    // Signed so the same request is accepted whatever the validation mode.
    const signature = createHmac("sha1", "unused")
      .update(
        url +
          Object.keys(params)
            .sort()
            .map((k) => k + params[k])
            .join(""),
      )
      .digest("base64");
    return [
      new NextRequest(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": signature,
        },
        body: new URLSearchParams(params).toString(),
      }),
      { params: Promise.resolve({ step }) },
    ] as const;
  }

  async function until<T>(
    read: () => Promise<T | undefined | false>,
    ms = 5000,
  ) {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error("condition not met in time");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("tells the owner when a caller hits the fail-safe, once, while the caller is still looked after", async () => {
    const { organization, user } =
      await getSaasStore().createOrganizationWithOwner({
        name: "Nord Plomberie",
        ownerEmail: "owner@nord.test",
        ownerName: "Owner",
        missedCallClientId: "client_live_outage",
        phoneE164: "+15145550177",
        accountType: "production",
      });

    const { getReceptionistRuntime } =
      await import("../../src/product/receptionist/runtime");
    const runtime = getReceptionistRuntime();
    const started = await twilioStep(
      ...webhook("incoming", {
        CallSid: "CAlive1",
        From: "+15145559876",
        To: "+14385597001",
      }),
    );
    const session = (await started.text()).match(
      /session=(rcs_[0-9a-f-]+)/,
    )?.[1];
    assert.ok(session);

    // The session store goes down in the middle of the call.
    runtime.store.getSession = async () => {
      throw new Error("synthetic database outage");
    };
    for (let caller = 1; caller <= 3; caller++) {
      const response = await twilioStep(
        ...webhook(
          "gather",
          {
            CallSid: "CAlive" + caller,
            SpeechResult: "hello",
            To: "+14385597001",
          },
          `?session=${session}`,
        ),
      );
      const xml = await response.text();
      assert.equal(response.status, 200);
      assert.match(xml, /problème technique/);
      assert.match(xml, /<Dial [^>]*><Number>\+14385597004<\/Number><\/Dial>/);
    }

    const service = getNotificationService();
    const alerts = await until(async () => {
      const rows = (await service.listForUser(organization.id, user.id)).filter(
        (row) => row.note.type === "receptionist_offline",
      );
      return rows.length > 0 ? rows : undefined;
    });
    assert.equal(alerts.length, 1, "three failed calls, one alert");
    assert.equal(alerts[0].note.priority, "critical");
    const deliveries = (await service.history(organization.id)).filter(
      (delivery) => delivery.notificationId === alerts[0].note.id,
    );
    // The owner has no verified personal number: email/in-app remain available.
    assert.deepEqual(
      [...new Set(deliveries.map((delivery) => delivery.channel))].sort(),
      ["email", "in_app"],
    );
    assert.equal(
      deliveries.filter((delivery) => delivery.idempotencyKey.endsWith(":sms"))
        .length,
      0,
    );
  });
});

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe(
  "receptionist outage alerts in isolated PostgreSQL",
  { skip: !databaseUrl },
  () => {
    let schema: Awaited<ReturnType<typeof createNotificationTestSchema>>;
    before(async () => {
      schema = await createNotificationTestSchema(databaseUrl!);
    });
    after(async () => {
      await closePgPool();
      await schema?.drop();
    });
    outageChecks(() =>
      createPostgresNotificationStore(schema.connectionString),
    );
  },
);
