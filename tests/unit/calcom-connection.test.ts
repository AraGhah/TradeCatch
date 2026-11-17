import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { resolveEventType } from "../../src/product/scheduling/calcom/adapter";
import {
  CALCOM_API_KEY_PATTERN,
  calcomBaseUrl,
  getMe,
} from "../../src/product/scheduling/calcom/client";
import {
  calcomMultiCrew,
  calcomPilotAllowed,
  connectCalcom,
  connectCalcomSchema,
  disconnectCalcom,
  openCalcomKey,
  publicConnection,
  sealCalcomKey,
} from "../../src/product/scheduling/calcom/connection";
import { reconcileCalcom, reconcileCalcomOrganization } from "../../src/product/scheduling/calcom/reconcile";
import {
  calcomUidFrom,
  isCalcomEventId,
  type CalcomRoute,
} from "../../src/product/scheduling/calcom/types";
import { createPhoneScheduler } from "../../src/product/receptionist/phone-booking";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";
import {
  createSchedulingService,
  createSimulatedCalendar,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import {
  calcomPortFor,
  getSchedulingService,
  getSchedulingStore,
  resetSchedulingRuntimeForTests,
} from "../../src/product/scheduling/runtime";
import { getSaasStore } from "../../src/product/saas/runtime";
import {
  CALCOM_KEY,
  MONDAY_10,
  MONDAY_11,
  NOW,
  ORG,
  bookInput,
  createCalcomSim,
  createHarness,
  type Harness,
} from "./helpers/calcom-sim";

const AUTH_SECRET = "test-auth-secret-0123456789abcdef0123456789"; // secret-scan: allow

describe("Cal.com credentials and environment", () => {
  const saved = { ...process.env };
  before(() => {
    process.env.AUTH_SECRET = AUTH_SECRET;
  });
  after(() => {
    process.env = { ...saved };
  });

  it("recognises Cal.com API keys and nothing else", () => {
    for (const ok of [CALCOM_KEY, "cal_abcdefghij", "cal_live_" + "x".repeat(40)]) {
      assert.ok(CALCOM_API_KEY_PATTERN.test(ok), ok);
    }
    for (const bad of ["", "cal_short", "sk_live_0123456789", " cal_live_0123456789", "cal_live_0123456789\n", "cal_a b c d e f g h"]) {
      assert.ok(!CALCOM_API_KEY_PATTERN.test(bad), JSON.stringify(bad));
    }
  });

  it("talks to Cal.com over HTTPS only, except for a local mock", () => {
    assert.equal(calcomBaseUrl(""), "https://api.cal.com");
    assert.equal(calcomBaseUrl("http://evil.example"), "https://api.cal.com");
    assert.equal(calcomBaseUrl("ftp://api.cal.com"), "https://api.cal.com");
    assert.equal(calcomBaseUrl("not a url"), "https://api.cal.com");
    assert.equal(calcomBaseUrl("https://api.cal.eu/path"), "https://api.cal.eu");
    assert.equal(calcomBaseUrl("http://localhost:4010"), "http://localhost:4010");
  });

  it("puts the key only in the Authorization header and never in a result", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const reply = (status: number, body: string) => async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(body, { status });
    };
    const results = [
      await getMe({ apiKey: CALCOM_KEY, fetchImpl: reply(401, '{"status":"error"}') }),
      await getMe({ apiKey: CALCOM_KEY, fetchImpl: reply(429, "{}") }),
      await getMe({ apiKey: CALCOM_KEY, fetchImpl: reply(500, "boom") }),
      await getMe({ apiKey: CALCOM_KEY, fetchImpl: reply(200, "<html>") }),
      await getMe({
        apiKey: CALCOM_KEY,
        fetchImpl: async () => {
          throw new Error(`failed with ${CALCOM_KEY}`);
        },
      }),
    ];
    assert.deepEqual(
      results.map((r) => (r.ok ? "ok" : `${r.kind}:${"code" in r ? r.code : ""}`)),
      ["rejected:unauthorized", "rejected:rate_limited", "ambiguous:server_error", "ambiguous:bad_response", "ambiguous:network_error"],
    );
    assert.ok(!JSON.stringify(results).includes(CALCOM_KEY));
    for (const { url, init } of seen) {
      assert.ok(!url.includes(CALCOM_KEY));
      assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${CALCOM_KEY}`);
      assert.equal(init.redirect, "error", "a redirect would carry the key elsewhere");
    }
  });

  it("seals the key so it can only be opened with this deployment's secret", () => {
    const sealed = sealCalcomKey(CALCOM_KEY);
    assert.ok(!sealed.includes(CALCOM_KEY));
    assert.equal(openCalcomKey(sealed), CALCOM_KEY);
    assert.equal(openCalcomKey(undefined), null);
    assert.equal(openCalcomKey("not-a-sealed-value"), null);
    process.env.AUTH_SECRET = "another-secret-0123456789abcdef0123456789"; // secret-scan: allow
    assert.equal(openCalcomKey(sealed), null, "a different secret cannot open it");
    process.env.AUTH_SECRET = AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    assert.throws(() => sealCalcomKey(CALCOM_KEY), /AUTH_SECRET/);
    process.env.AUTH_SECRET = AUTH_SECRET;
  });

  it("keeps Cal.com ids apart from other providers' ids", () => {
    assert.equal(calcomUidFrom("calcom:abcd1234"), "abcd1234");
    assert.equal(calcomUidFrom("abcd1234"), null, "a Google event id is not a Cal.com uid");
    assert.equal(calcomUidFrom("calcom:../etc/passwd"), null);
    assert.equal(calcomUidFrom("calcom:ab"), null);
    assert.equal(isCalcomEventId("calcom:x"), true);
    assert.equal(isCalcomEventId("gcal:x"), false);
    assert.equal(isCalcomEventId(undefined), false);
  });
});

describe("Which Cal.com event type serves a booking", () => {
  const routes: CalcomRoute[] = [
    { eventTypeId: 21, serviceId: "svc-a" },
    { eventTypeId: 22, technicianId: "tech-1" },
    { eventTypeId: 23, serviceId: "svc-a", technicianId: "tech-1" },
  ];
  const pick = (input: { serviceId?: string; technicianId?: string; multiCrew?: boolean }) =>
    resolveEventType({ routes, defaultEventTypeId: 99, multiCrew: input.multiCrew ?? true, ...input });

  it("prefers the most specific route", () => {
    assert.equal(pick({ serviceId: "svc-a", technicianId: "tech-1" }), 23);
    assert.equal(pick({ technicianId: "tech-1" }), 22);
    assert.equal(pick({ serviceId: "svc-a" }), 21);
    assert.equal(pick({ serviceId: "svc-a", technicianId: "tech-2" }), 21);
    assert.equal(pick({ serviceId: "svc-b" }), 99);
    assert.equal(pick({}), 99);
  });

  it("ignores specialist routes on a plan without specialist calendars", () => {
    assert.equal(pick({ serviceId: "svc-a", technicianId: "tech-1", multiCrew: false }), 21);
    assert.equal(pick({ technicianId: "tech-1", multiCrew: false }), 99);
  });
});

describe("Cal.com is enrolled by the operator, per business", () => {
  const org = {
    id: "org_1",
    status: "active" as const,
    accountType: "production" as const,
    plan: "professional" as const,
    features: { appointmentBooking: true },
  } as unknown as Parameters<typeof calcomPilotAllowed>[0];
  const patch = (over: Record<string, unknown>) =>
    ({ ...(org as object), ...over }) as unknown as Parameters<typeof calcomPilotAllowed>[0];

  it("needs the enrollment list, an active account and a plan with appointments", () => {
    assert.equal(calcomPilotAllowed(org, "org_1"), true);
    assert.equal(calcomPilotAllowed(org, " org_9 , org_1 "), true);
    assert.equal(calcomPilotAllowed(org, ""), false, "nobody is enrolled by default");
    assert.equal(calcomPilotAllowed(org, "org_10"), false);
    assert.equal(calcomPilotAllowed(org, "org_"), false, "ids match exactly");
    assert.equal(calcomPilotAllowed(null, "org_1"), false);
    assert.equal(calcomPilotAllowed(patch({ status: "suspended" }), "org_1"), false);
    assert.equal(calcomPilotAllowed(patch({ accountType: "demo" }), "org_1"), false);
    assert.equal(calcomPilotAllowed(patch({ plan: "essential" }), "org_1"), false);
    assert.equal(calcomPilotAllowed(patch({ features: { appointmentBooking: false } }), "org_1"), false);
  });

  it("allows specialist calendars only on the plan that includes them", () => {
    assert.equal(calcomMultiCrew({ plan: "professional" }), false);
    assert.equal(calcomMultiCrew({ plan: "receptionist" }), true);
    assert.equal(calcomMultiCrew(null), false);
  });
});

describe("connecting a Cal.com account", () => {
  const saved = { ...process.env };
  before(() => {
    process.env.AUTH_SECRET = AUTH_SECRET;
  });
  after(() => {
    process.env = { ...saved };
  });

  async function setup(options: { multiCrew?: boolean; validKey?: string } = {}) {
    const h = await createHarness({ mode: "simulated", sim: { validKey: options.validKey } });
    const deps = {
      store: h.store,
      scheduling: h.service,
      fetchImpl: h.sim.fetch,
      multiCrew: options.multiCrew ?? false,
      now: () => NOW,
    };
    return { h, deps };
  }
  const input = (over: Record<string, unknown> = {}) =>
    connectCalcomSchema.parse({ apiKey: CALCOM_KEY, defaultEventTypeId: 11, ...over });
  const mode = async (h: Harness) => (await h.service.getRules(ORG)).calendarMode;

  it("accepts a valid key and event types, stores the key sealed and switches the calendar", async () => {
    const { h, deps } = await setup();
    const result = await connectCalcom(deps, ORG, input());
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.connection.status, "connected");
    assert.equal(result.connection.accountEmail, "owner@nord.test");
    assert.equal(result.connection.credential, "api_key");
    assert.ok(!JSON.stringify(result).includes(CALCOM_KEY), "the key never comes back");
    assert.ok(!("credentialCiphertext" in result.connection));

    const stored = await h.store.getCalcomConnection(ORG);
    assert.ok(stored?.credentialCiphertext);
    assert.ok(!stored!.credentialCiphertext!.includes(CALCOM_KEY));
    assert.equal(openCalcomKey(stored!.credentialCiphertext), CALCOM_KEY);
    assert.equal(await mode(h), "calcom");
  });

  it("changes nothing when the key is refused", async () => {
    const { h, deps } = await setup({ validKey: "cal_live_another_0123456789" });
    const result = await connectCalcom(deps, ORG, input());
    assert.deepEqual(result, { ok: false, code: "unauthorized" });
    assert.equal(await h.store.getCalcomConnection(ORG), null);
    assert.equal(await mode(h), "simulated");
  });

  it("refuses event types that cannot be booked unattended", async () => {
    const { h, deps } = await setup();
    for (const [id, why] of [[13, "requires_confirmation"], [14, "seated"], [15, "recurring"], [16, "instant"]] as const) {
      const result = await connectCalcom(deps, ORG, input({ defaultEventTypeId: id }));
      assert.deepEqual(result, { ok: false, code: "event_type_unbookable", detail: `${id}:${why}` });
    }
    assert.equal(await h.store.getCalcomConnection(ORG), null);
    const fine = await connectCalcom(deps, ORG, input({ defaultEventTypeId: 17 }));
    assert.ok(fine.ok, "confirmation switched off means it books straight away");
  });

  it("refuses an event type the account does not have", async () => {
    const { deps } = await setup();
    const result = await connectCalcom(deps, ORG, input({ defaultEventTypeId: 999 }));
    assert.deepEqual(result, { ok: false, code: "event_type_not_found", detail: "999" });
    const inRoute = await connectCalcom(deps, ORG, input({ routes: [{ eventTypeId: 998, serviceId: undefined }] }));
    assert.equal(inRoute.ok, false);
  });

  it("only maps services of the business itself", async () => {
    const { h, deps } = await setup({ multiCrew: true });
    const mine = (await h.service.listServices(ORG))[0]!;
    const foreign = (await h.service.listServices("another-business"))[0]!;
    const ok = await connectCalcom(deps, ORG, input({ routes: [{ eventTypeId: 12, serviceId: mine.id }] }));
    assert.ok(ok.ok);
    const other = await connectCalcom(deps, ORG, input({ routes: [{ eventTypeId: 12, serviceId: foreign.id }] }));
    assert.deepEqual(other, { ok: false, code: "unknown_service", detail: foreign.id });
    const technician = await connectCalcom(deps, ORG, input({ routes: [{ eventTypeId: 12, technicianId: "tech-of-nobody" }] }));
    assert.deepEqual(technician, { ok: false, code: "unknown_technician", detail: "tech-of-nobody" });
  });

  it("maps a specialist only on a plan with specialist calendars", async () => {
    const { h, deps } = await setup();
    await h.store.saveTechnician({ id: "tech-1", organizationId: ORG, name: "Luc", active: true });
    const body = input({ routes: [{ eventTypeId: 12, technicianId: "tech-1" }] });
    assert.deepEqual(await connectCalcom(deps, ORG, body), { ok: false, code: "specialists_not_included" });
    const plus = await connectCalcom({ ...deps, multiCrew: true }, ORG, body);
    assert.ok(plus.ok);
  });

  it("refuses two routes for the same service and specialist, and a missing key", async () => {
    const { h, deps } = await setup();
    const service = (await h.service.listServices(ORG))[0]!;
    const twice = await connectCalcom(
      deps,
      ORG,
      input({ routes: [{ eventTypeId: 11, serviceId: service.id }, { eventTypeId: 12, serviceId: service.id }] }),
    );
    assert.equal(twice.ok === false && twice.code, "duplicate_route");
    assert.deepEqual(await connectCalcom(deps, ORG, input({ apiKey: undefined })), { ok: false, code: "api_key_required" });
  });

  it("warns when the event type is not as long as the service", async () => {
    const { h, deps } = await setup();
    const drain = (await h.service.listServices(ORG)).find((s) => s.durationMinutes === 30)!;
    const result = await connectCalcom(deps, ORG, input({ routes: [{ eventTypeId: 11, serviceId: drain.id }] }));
    assert.ok(result.ok);
    assert.deepEqual(result.warnings.map((w) => w.code), ["length_mismatch"]);
  });

  it("keeps the stored key when it is not sent again", async () => {
    const { h, deps } = await setup();
    await connectCalcom(deps, ORG, input());
    const before = (await h.store.getCalcomConnection(ORG))!.credentialCiphertext;
    const result = await connectCalcom(deps, ORG, input({ apiKey: undefined, defaultEventTypeId: 12 }));
    assert.ok(result.ok);
    const stored = (await h.store.getCalcomConnection(ORG))!;
    assert.equal(stored.credentialCiphertext, before);
    assert.equal(stored.defaultEventTypeId, 12);
  });

  it("disconnecting wipes the credential and puts the calendar back", async () => {
    const { h, deps } = await setup();
    await connectCalcom(deps, ORG, input());
    await disconnectCalcom(deps, ORG);
    const stored = (await h.store.getCalcomConnection(ORG))!;
    assert.equal(stored.status, "disconnected");
    assert.equal(stored.credentialCiphertext, undefined);
    assert.equal(publicConnection(stored)?.credential, "none");
    assert.equal(await mode(h), "simulated");
  });

  it("validates the request body strictly", () => {
    assert.ok(connectCalcomSchema.safeParse({ apiKey: CALCOM_KEY, defaultEventTypeId: 11 }).success);
    for (const bad of [
      { apiKey: "not-a-key", defaultEventTypeId: 11 },
      { apiKey: CALCOM_KEY, defaultEventTypeId: -1 },
      { apiKey: CALCOM_KEY, defaultEventTypeId: 11, extra: true },
      { apiKey: CALCOM_KEY, defaultEventTypeId: 11, routes: [{ eventTypeId: 1, other: "x" }] },
      { apiKey: CALCOM_KEY, defaultEventTypeId: 11, routes: Array.from({ length: 51 }, () => ({ eventTypeId: 1 })) },
      { apiKey: CALCOM_KEY, defaultEventTypeId: 11, attendeeEmail: "nope" },
      { defaultEventTypeId: "11" },
    ]) {
      assert.equal(connectCalcomSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
    }
  });
});

describe("a business's Cal.com connection is re-checked on every use", () => {
  const saved = { ...process.env };
  const quiet = () => mock.method(console, "warn", () => {});

  async function enrolledBusiness() {
    process.env.AUTH_SECRET = AUTH_SECRET;
    resetSchedulingRuntimeForTests();
    const { organization } = await getSaasStore().createOrganizationWithOwner({
      name: "Nord Plomberie",
      ownerEmail: `owner-${Math.random().toString(36).slice(2)}@calcom.test`,
      ownerName: "Owner",
      accountType: "production",
    });
    await getSaasStore().updateOrganizationPlan(organization.id, "professional");
    process.env.CALCOM_PILOT_ORG_IDS = organization.id;
    await getSchedulingStore().saveCalcomConnection({
      organizationId: organization.id,
      status: "connected",
      credentialKind: "api_key",
      credentialCiphertext: sealCalcomKey(CALCOM_KEY),
      defaultEventTypeId: 11,
      routes: [],
      updatedAt: NOW.toISOString(),
    });
    return organization;
  }

  afterEach(() => {
    process.env = { ...saved };
    resetSchedulingRuntimeForTests();
    mock.restoreAll();
  });

  it("builds the Cal.com calendar only while every condition holds", async () => {
    quiet();
    const org = await enrolledBusiness();
    assert.equal((await calcomPortFor(org.id))?.kind, "calcom");

    process.env.CALCOM_PILOT_ORG_IDS = "someone-else";
    assert.equal(await calcomPortFor(org.id), null, "un-enrolled");
    process.env.CALCOM_PILOT_ORG_IDS = org.id;
    assert.equal((await calcomPortFor(org.id))?.kind, "calcom");

    await getSaasStore().updateOrganizationPlan(org.id, "essential");
    assert.equal(await calcomPortFor(org.id), null, "downgraded");
    await getSaasStore().updateOrganizationPlan(org.id, "professional");

    await getSaasStore().updateOrganization(org.id, { status: "suspended" });
    assert.equal(await calcomPortFor(org.id), null, "suspended");
    await getSaasStore().updateOrganization(org.id, { status: "active" });

    const connection = (await getSchedulingStore().getCalcomConnection(org.id))!;
    await getSchedulingStore().saveCalcomConnection({ ...connection, status: "error" });
    assert.equal(await calcomPortFor(org.id), null, "key rejected");
    await getSchedulingStore().saveCalcomConnection({ ...connection, credentialCiphertext: "garbage" });
    assert.equal(await calcomPortFor(org.id), null, "unreadable credential");
    assert.equal(await calcomPortFor("another-business"), null, "no connection");
  });

  it("never falls back to a simulated calendar when a Cal.com business loses its connection", async () => {
    quiet();
    const org = await enrolledBusiness();
    const scheduling = getSchedulingService();
    await scheduling.setCalendarMode(org.id, "calcom");
    process.env.CALCOM_PILOT_ORG_IDS = "";
    const result = await scheduling.book(bookInput({ organizationId: org.id }));
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_unavailable");
    assert.equal(result.appointment?.simulated, false);
    assert.equal(await scheduling.calendarReady(org.id), false);
  });
});

describe("TradeCatch follows what the contractor does in Cal.com", () => {
  async function ready() {
    const h = await createHarness();
    await h.store.saveCalcomConnection({
      organizationId: ORG,
      status: "connected",
      credentialKind: "api_key",
      defaultEventTypeId: 11,
      routes: [],
      updatedAt: NOW.toISOString(),
    });
    const rejected: string[] = [];
    const deps = (over: Record<string, unknown> = {}) => ({
      store: h.store,
      scheduling: h.service,
      portFor: async () => h.port(),
      checkKey: async () => "ok" as const,
      onKeyRejected: async (org: string) => {
        rejected.push(org);
      },
      now: () => h.clock.now,
      ...over,
    });
    const book = async (startAt = MONDAY_10) => {
      const result = await h.service.book(bookInput({ startAt, idempotencyKey: `k-${startAt}` }));
      assert.equal(result.confirmed, true);
      const appointment = result.appointment!;
      return { appointment, uid: appointment.calendarEventId!.slice("calcom:".length) };
    };
    return { h, deps, book, rejected };
  }

  it("cancels locally what the contractor cancelled in Cal.com", async () => {
    const { h, deps, book } = await ready();
    const { appointment, uid } = await book();
    h.sim.externalCancel(uid);
    const totals = await reconcileCalcomOrganization(deps(), ORG);
    assert.equal(totals.canceledLocally, 1);
    const stored = await h.store.getAppointment(ORG, appointment.id);
    assert.equal(stored?.status, "canceled");
    assert.equal(stored?.cancelReason, "provider_canceled");
    assert.ok(h.notified.some((n) => n.kind === "canceled" && n.refId === appointment.id));
    assert.ok(h.canceledNotices.includes(appointment.id), "the reminders are stopped");
  });

  it("moves locally what the contractor moved in Cal.com", async () => {
    const { h, deps, book } = await ready();
    const { appointment, uid } = await book();
    const moved = h.sim.externalMove(uid, MONDAY_11);
    const totals = await reconcileCalcomOrganization(deps(), ORG);
    assert.equal(totals.moved, 1);
    const stored = await h.store.getAppointment(ORG, appointment.id);
    assert.equal(stored?.status, "confirmed");
    assert.equal(stored?.startAt, MONDAY_11);
    assert.equal(stored?.calendarEventId, `calcom:${moved.uid}`);
    assert.ok(h.notified.some((n) => n.kind === "rescheduled"));
    const again = await reconcileCalcomOrganization(deps(), ORG);
    assert.equal(again.moved, 0, "nothing more to follow");
  });

  it("reports a booking Cal.com no longer has without cancelling the customer's appointment", async () => {
    const { h, deps, book } = await ready();
    const { appointment, uid } = await book();
    h.sim.bookings.delete(uid);
    const totals = await reconcileCalcomOrganization(deps(), ORG);
    assert.equal(totals.missing, 1);
    await reconcileCalcomOrganization(deps(), ORG);
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "confirmed");
    const events = await h.store.listEvents(ORG, appointment.id);
    assert.equal(events.filter((e) => e.kind === "provider_missing").length, 1, "reported once");
  });

  it("leaves a booking the contractor still has to approve", async () => {
    const { h, deps, book } = await ready();
    const { appointment, uid } = await book();
    h.sim.bookings.get(uid)!.status = "pending";
    const totals = await reconcileCalcomOrganization(deps(), ORG);
    assert.equal(totals.needsAttention, 1);
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "confirmed");
  });

  it("does nothing while Cal.com cannot be asked", async () => {
    const { h, deps, book } = await ready();
    const { appointment, uid } = await book();
    h.sim.externalCancel(uid);
    const totals = await reconcileCalcomOrganization(deps({ checkKey: async () => "unreachable" }), ORG);
    assert.equal(totals.skipped, 1);
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "confirmed");
  });

  it("flags a refused key once, then recovers when the key works again", async () => {
    const { h, deps, book, rejected } = await ready();
    const { appointment, uid } = await book();
    h.sim.externalCancel(uid);
    const refused = deps({ checkKey: async () => "unauthorized" });
    await reconcileCalcomOrganization(refused, ORG);
    await reconcileCalcomOrganization(refused, ORG);
    assert.deepEqual(rejected, [ORG], "the owner is told once");
    assert.equal((await h.store.getCalcomConnection(ORG))?.status, "error");
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "confirmed", "no guessing with a refused key");

    await reconcileCalcomOrganization(deps(), ORG);
    assert.equal((await h.store.getCalcomConnection(ORG))?.status, "connected");
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "canceled");
  });

  it("skips a business that disconnected, and survives one failing business", async () => {
    const { h, deps } = await ready();
    await h.store.saveCalcomConnection({ ...(await h.store.getCalcomConnection(ORG))!, status: "disconnected" });
    const sweep = await reconcileCalcom(deps());
    assert.equal(sweep.organizations, 0, "a disconnected business is not even visited");
    const direct = await reconcileCalcomOrganization(deps(), ORG);
    assert.equal(direct.skipped, 1);
    assert.equal(direct.errors, 0);

    await h.store.saveCalcomConnection({ ...(await h.store.getCalcomConnection(ORG))!, status: "connected" });
    const failing = await reconcileCalcom(
      deps({
        portFor: async () => {
          throw new Error("boom");
        },
      }),
    );
    assert.equal(failing.errors, 1);
  });

  it("keeps one business's ledger invisible to another", async () => {
    const { h, book } = await ready();
    const { appointment, uid } = await book();
    assert.ok(await h.store.getCalcomBooking(ORG, appointment.id));
    assert.equal(await h.store.getCalcomBooking("other-business", appointment.id), null);
    assert.ok(await h.store.findCalcomBookingByUid(ORG, uid));
    assert.equal(await h.store.findCalcomBookingByUid("other-business", uid), null);
    assert.deepEqual(await h.store.listCalcomBookings("other-business", ["confirmed"], 10), []);
  });
});

describe("the phone receptionist and Cal.com", () => {
  const config = {} as ReceptionistConfig;
  const common = { config, language: "fr" as const, serviceName: "Inspection", callerName: "Marie Tremblay", callbackE164: "+15145559876", serviceAddress: "12 rue des Pins, Laval, QC H7N 1A1" };

  function scheduler(h: Harness) {
    return createPhoneScheduler({ scheduling: async () => h.service, findOrganizationId: async () => ORG });
  }

  it("reads out only times Cal.com offers, and confirms only what Cal.com accepted", async () => {
    const h = await createHarness();
    const phone = scheduler(h);
    const drain = (await h.service.listServices(ORG)).find((s) => s.durationMinutes === 30)!;
    const openings = await phone.listOpenings({
      config,
      language: "fr",
      serviceId: drain.id,
      from: new Date("2026-10-19T11:00:00.000Z"),
      until: new Date("2026-10-19T23:00:00.000Z"),
    });
    assert.ok(openings.ok);
    assert.ok(openings.slots.length > 0);
    for (const slot of openings.slots) assert.ok(h.sim.offered.has(slot.startAt));

    const booked = await phone.reserve({ ...common, serviceId: drain.id, startAt: MONDAY_10, idempotencyKey: "rcb:call:1" });
    assert.equal(booked.status, "confirmed");
    assert.equal(h.sim.active().length, 1);
    const repeated = await phone.reserve({ ...common, serviceId: drain.id, startAt: MONDAY_10, idempotencyKey: "rcb:call:1" });
    assert.equal(repeated.status, "confirmed");
    assert.equal(h.sim.active().length, 1, "a repeated tool call books nothing twice");
  });

  it("offers other times when the one asked for was just taken", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("slot_taken");
    const result = await scheduler(h).reserve({ ...common, startAt: MONDAY_10, idempotencyKey: "rcb:call:2" });
    assert.equal(result.status, "conflict");
    assert.ok(result.status === "conflict" && result.alternatives.length > 0);
    assert.equal(h.sim.active().length, 0);
  });

  it("is a request, never a confirmation, when Cal.com does not accept or cannot be reached", async () => {
    for (const behaviour of ["pending", "start_shifted", "server_error", "lost", "applied_then_lost"] as const) {
      const h = await createHarness();
      h.sim.createBehaviours.push(behaviour);
      const result = await scheduler(h).reserve({ ...common, startAt: MONDAY_10, idempotencyKey: `rcb:call:${behaviour}` });
      assert.equal(result.status, "request", behaviour);
    }
  });

  it("offers no time when the business is on Cal.com but cannot book through it", async () => {
    const store = createMemorySchedulingStore();
    const service = createSchedulingService({ store, now: () => NOW, calendar: async () => createSimulatedCalendar() });
    await service.setCalendarMode(ORG, "calcom");
    const phone = createPhoneScheduler({ scheduling: async () => service, findOrganizationId: async () => ORG });
    const openings = await phone.listOpenings({ config, language: "fr", from: NOW });
    assert.deepEqual(openings, { ok: false, reason: "not_bookable" });
    const reserved = await phone.reserve({ ...common, startAt: MONDAY_10, idempotencyKey: "rcb:call:3" });
    assert.equal(reserved.status, "request");
  });

  it("the simulator itself behaves: a second booking of the same time is refused", async () => {
    const sim = createCalcomSim();
    const ask = () =>
      sim.fetch("https://api.cal.com/v2/bookings", {
        method: "POST",
        headers: { Authorization: `Bearer ${CALCOM_KEY}` },
        body: JSON.stringify({ start: MONDAY_10, eventTypeId: 11, attendee: {}, metadata: {} }),
      });
    assert.equal((await ask()).status, 201);
    assert.equal((await ask()).status, 400);
    const wrongKey = await sim.fetch("https://api.cal.com/v2/me", { method: "GET", headers: { Authorization: "Bearer nope" } });
    assert.equal(wrongKey.status, 401);
  });
});
