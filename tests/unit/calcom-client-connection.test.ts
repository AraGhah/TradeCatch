import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  createCalcomClient,
  parseBooking,
} from "../../src/product/scheduling/calcom/client";
import { connectCalcom } from "../../src/product/scheduling/calcom/connection";
import {
  isValidCalcomApiKey,
  openCalcomApiKey,
  sealCalcomApiKey,
} from "../../src/product/scheduling/calcom/credentials";
import {
  candidateEventTypes,
  calcomEventId,
  calcomUid,
} from "../../src/product/scheduling/calcom/provider";
import { toPublicConnection } from "../../src/product/scheduling/calcom/types";
import { encryptSecret } from "../../src/product/scheduling/crypto";
import { createSchedulingService } from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import { createFakeCalcom } from "./support/fake-calcom";

const KEY = "cal_live_0123456789abcdef";
const SLOT = "2026-11-18T15:00:00.000Z";
const NOW = new Date("2026-11-16T12:00:00Z");

describe("Cal.com client", () => {
  it("sends the key as a bearer and the documented version header per endpoint", async () => {
    const fake = createFakeCalcom({ slots: [SLOT] });
    const client = createCalcomClient({ apiKey: KEY, fetchImpl: fake.fetch, env: {} });
    await client.listEventTypes();
    await client.slots({ eventTypeId: 11, from: NOW, until: new Date(NOW.getTime() + 86_400_000 * 7), timeZone: "America/Toronto" });
    await client.listBookings({ eventTypeIds: [11], afterStart: NOW, beforeEnd: new Date(NOW.getTime() + 86_400_000) });
    await client.getBooking("none");
    const version = (path: RegExp) => fake.requests.find((r) => path.test(r.path))!.headers["cal-api-version"];
    assert.equal(version(/^\/event-types$/), "2026-06-12");
    assert.equal(version(/^\/slots$/), "2024-09-04");
    assert.equal(version(/^\/bookings$/), "2026-05-01");
    assert.equal(version(/^\/bookings\/none$/), "2026-02-25");
    assert.ok(fake.requests.every((r) => r.headers.authorization === `Bearer ${KEY}`));
  });

  it("lets an operator pin a different version without a code change", async () => {
    const fake = createFakeCalcom({ slots: [] });
    const client = createCalcomClient({
      apiKey: KEY,
      fetchImpl: fake.fetch,
      env: { CALCOM_API_VERSION_SLOTS: "2025-01-01", CALCOM_API_VERSION_BOOKINGS_LIST: "not-a-date" },
    });
    await client.slots({ eventTypeId: 1, from: NOW, until: new Date(NOW.getTime() + 3600_000), timeZone: "UTC" });
    await client.listBookings({ eventTypeIds: [1], afterStart: NOW, beforeEnd: NOW });
    assert.equal(fake.requests[0].headers["cal-api-version"], "2025-01-01");
    assert.equal(fake.requests[1].headers["cal-api-version"], "2026-05-01", "an invalid override is ignored");
  });

  it("reads slots in the range format as UTC instants, sorted", async () => {
    const fake = createFakeCalcom({ slots: ["2026-11-19T15:00:00.000Z", SLOT] });
    const client = createCalcomClient({ apiKey: KEY, fetchImpl: fake.fetch, env: {} });
    const result = await client.slots({ eventTypeId: 11, from: NOW, until: new Date(NOW.getTime() + 86_400_000 * 7), timeZone: "America/Toronto" });
    assert.ok(result.ok);
    assert.deepEqual(result.ok && result.data.map((s) => s.startAt), [SLOT, "2026-11-19T15:00:00.000Z"]);
  });

  describe("failure classification", () => {
    const failing = (response: () => Response | Promise<Response>) =>
      createCalcomClient({ apiKey: KEY, fetchImpl: (async () => response()) as unknown as typeof fetch, env: {} });
    const request = { eventTypeId: 1, startAt: SLOT, attendee: { name: "A", timeZone: "UTC", language: "en" as const }, metadata: {} };

    it("a refused key, a rate limit and other refusals prove nothing was created", async () => {
      assert.deepEqual(await failing(() => new Response("{}", { status: 401 })).createBooking(request), { ok: false, kind: "auth", status: 401 });
      assert.deepEqual(await failing(() => new Response("{}", { status: 429 })).createBooking(request), { ok: false, kind: "rate_limited", status: 429 });
      assert.deepEqual(await failing(() => new Response('{"error":"bad field"}', { status: 400 })).createBooking(request), { ok: false, kind: "rejected", status: 400 });
    });

    it("a taken slot is recognised on a booking, not guessed on other calls", async () => {
      const taken = () => new Response('{"error":{"message":"no_available_users_found_error"}}', { status: 400 });
      assert.equal((await failing(taken).createBooking(request) as { kind: string }).kind, "slot_unavailable");
      assert.equal((await failing(() => new Response("{}", { status: 409 })).createBooking(request) as { kind: string }).kind, "slot_unavailable");
      assert.equal((await failing(taken).cancel("x") as { kind: string }).kind, "rejected");
    });

    it("a server error, a dropped connection and a timeout are unknown, never failure-with-certainty", async () => {
      assert.equal((await failing(() => new Response("oops", { status: 502 })).createBooking(request) as { kind: string }).kind, "unknown");
      assert.equal((await failing(() => { throw new TypeError("fetch failed"); }).createBooking(request) as { kind: string }).kind, "unknown");
      assert.equal((await failing(() => { throw new DOMException("timed out", "TimeoutError"); }).createBooking(request) as { kind: string }).kind, "unknown");
    });

    it("a success that is not a usable booking is not proof of one", async () => {
      for (const body of ['{"status":"success","data":{}}', '{"status":"success"}', "not json", '{"status":"error"}']) {
        const result = await failing(() => new Response(body, { status: 201 })).createBooking(request);
        assert.equal(result.ok, false, body);
      }
      const cancelledBooking = { status: "success", data: { uid: "u", status: "cancelled", start: SLOT, end: SLOT } };
      assert.equal((await failing(() => Response.json(cancelledBooking, { status: 201 })).createBooking(request)).ok, false);
    });

    it("does not follow redirects (the key would go to another host)", async () => {
      let init: RequestInit | undefined;
      const client = createCalcomClient({
        apiKey: KEY,
        fetchImpl: (async (_url: unknown, i?: RequestInit) => {
          init = i;
          return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch,
        env: {},
      });
      await client.listEventTypes();
      assert.equal(init?.redirect, "error");
    });

    it("never writes request or response content to the log", async () => {
      const lines: string[] = [];
      const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
      for (const k of Object.keys(originals) as (keyof typeof originals)[]) {
        console[k] = (...args: unknown[]) => lines.push(args.join(" "));
      }
      try {
        await failing(() => new Response('{"error":"Jean Tremblay 123 Rue Principale"}', { status: 400 })).createBooking({
          ...request,
          attendee: { name: "Jean Tremblay", timeZone: "UTC", language: "en" },
        });
      } finally {
        Object.assign(console, originals);
      }
      assert.deepEqual(lines, []);
    });

    it("an incomplete listing is a failure, never a partial answer", async () => {
      const fake = createFakeCalcom({ slots: [] });
      fake.state.list = "more_pages";
      const client = createCalcomClient({ apiKey: KEY, fetchImpl: fake.fetch, env: {} });
      const result = await client.listBookings({ eventTypeIds: [11], afterStart: NOW, beforeEnd: NOW, maxPages: 2 });
      assert.equal(result.ok, false);
    });
  });

  it("canceling a booking that is already gone counts as done", async () => {
    const fake = createFakeCalcom({ slots: [SLOT] });
    const seeded = fake.seed({ start: SLOT, status: "cancelled" });
    const client = createCalcomClient({ apiKey: KEY, fetchImpl: fake.fetch, env: {} });
    assert.deepEqual(await client.cancel(seeded.uid), { ok: true, data: true });
    assert.deepEqual(await client.cancel("never-existed"), { ok: true, data: true });
  });

  it("parses a booking's id, times, metadata and reschedule links", () => {
    const booking = parseBooking({
      uid: "u1",
      status: "accepted",
      start: "2026-11-18T10:00:00-05:00",
      end: "2026-11-18T11:00:00-05:00",
      eventType: { id: 11 },
      metadata: { tc_appointment_id: "appt_1" },
      rescheduledFromUid: "u0",
    });
    assert.deepEqual(booking, {
      uid: "u1",
      status: "accepted",
      startAt: "2026-11-18T15:00:00.000Z",
      endAt: "2026-11-18T16:00:00.000Z",
      eventTypeId: 11,
      tradecatchId: "appt_1",
      rescheduledFromUid: "u0",
    });
    assert.equal(parseBooking({ uid: "u", status: "mystery", start: SLOT, end: SLOT }), undefined);
    assert.equal(parseBooking(null), undefined);
  });
});

describe("Cal.com credentials", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-0123456789"; // secret-scan: allow
  });

  it("are sealed, and open only for this purpose", () => {
    const sealed = sealCalcomApiKey(KEY);
    assert.ok(!sealed.includes(KEY));
    assert.equal(openCalcomApiKey(sealed), KEY);
    // A sealed Google Calendar token (same cipher, same AUTH_SECRET) is not a Cal.com credential.
    const googleToken = encryptSecret(JSON.stringify({ kind: "api_key", apiKey: KEY }), process.env.AUTH_SECRET!);
    assert.equal(openCalcomApiKey(googleToken), null);
    assert.equal(openCalcomApiKey("garbage"), null);
  });

  it("cannot be opened after AUTH_SECRET changes", () => {
    const sealed = sealCalcomApiKey(KEY);
    process.env.AUTH_SECRET = "a-different-secret-0123456789"; // secret-scan: allow
    assert.equal(openCalcomApiKey(sealed), null);
  });

  it("refuse to seal anything without AUTH_SECRET", () => {
    delete process.env.AUTH_SECRET;
    assert.throws(() => sealCalcomApiKey(KEY), /AUTH_SECRET/);
  });

  it("the key shape is checked, and the dashboard view never carries the credential", () => {
    assert.equal(isValidCalcomApiKey(KEY), true);
    assert.equal(isValidCalcomApiKey("sk_live_nope"), false);
    assert.equal(isValidCalcomApiKey("cal_ short"), false);
    const view = toPublicConnection({
      organizationId: "o",
      status: "connected",
      credentialCiphertext: "sealed",
      eventTypes: [],
      language: "en",
      updatedAt: "2026-11-16T12:00:00.000Z",
    });
    assert.equal(JSON.stringify(view).includes("sealed"), false);
    assert.equal(view.hasCredential, true);
  });
});

describe("Cal.com event-type mapping", () => {
  const maps = [
    { eventTypeId: 1 },
    { eventTypeId: 2, serviceId: "svc_drain" },
    { eventTypeId: 3, serviceId: "svc_drain", technicianId: "t_alex" },
    { eventTypeId: 4, technicianId: "t_sam" },
  ];

  it("a service with its own event type uses only those", () => {
    assert.deepEqual(candidateEventTypes(maps, "svc_drain").map((m) => m.eventTypeId), [2, 3]);
  });
  it("any other service uses the default event types", () => {
    assert.deepEqual(candidateEventTypes(maps, "svc_other").map((m) => m.eventTypeId), [1, 4]);
    assert.deepEqual(candidateEventTypes(maps).map((m) => m.eventTypeId), [1, 4]);
  });
  it("a requested specialist narrows to that specialist's own calendar, or to nothing", () => {
    assert.deepEqual(candidateEventTypes(maps, "svc_drain", "t_alex").map((m) => m.eventTypeId), [3]);
    assert.deepEqual(candidateEventTypes(maps, "svc_drain", "t_nobody"), []);
  });
  it("event ids say which provider owns them", () => {
    assert.equal(calcomUid(calcomEventId("abc")), "abc");
    assert.equal(calcomUid("google_event_1"), null);
    assert.equal(calcomUid("simcal_x"), null);
    assert.equal(calcomUid("calcom:"), null);
  });
});

describe("connecting a business to Cal.com", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-0123456789"; // secret-scan: allow
  });

  async function business(org: string) {
    const store = createMemorySchedulingStore();
    const service = createSchedulingService({ store, now: () => NOW, calendar: async () => { throw new Error("unused"); } });
    await service.ensure(org);
    await store.saveService({
      id: "svc_drain", organizationId: org, name: "Drain", durationMinutes: 60, bufferMinutes: 0,
      bookingMode: "automatic", eligibleTechnicianIds: [], active: true,
    } as never);
    await store.saveTechnician({ id: "t_alex", organizationId: org, name: "Alex", active: true } as never);
    return { store, service };
  }

  it("proves the key with Cal.com, stores it sealed, and switches the business to Cal.com", async () => {
    const { store, service } = await business("org_c");
    const fake = createFakeCalcom({ slots: [] });
    const result = await connectCalcom({ store, service, fetchImpl: fake.fetch, env: {} }, { organizationId: "org_c", apiKey: KEY });
    assert.equal(result.ok, true);
    const row = await store.getCalcomConnection("org_c");
    assert.equal(row?.status, "connected");
    assert.deepEqual(row?.eventTypes, [{ eventTypeId: 11 }], "the single event type becomes the default");
    assert.ok(!JSON.stringify(row).includes(KEY), "the key is not stored in the clear");
    assert.equal(openCalcomApiKey(row!.credentialCiphertext!), KEY);
    assert.equal((await service.getRules("org_c")).calendarMode, "calcom");
    assert.equal(JSON.stringify(result).includes(KEY), false, "the key is never echoed back");
  });

  it("stores nothing when Cal.com rejects the key", async () => {
    const { store, service } = await business("org_c");
    const fake = createFakeCalcom({ slots: [] });
    fake.state.keyValid = false;
    const result = await connectCalcom({ store, service, fetchImpl: fake.fetch, env: {} }, { organizationId: "org_c", apiKey: KEY });
    assert.deepEqual(result, { ok: false, code: "key_rejected" });
    assert.equal(await store.getCalcomConnection("org_c"), null);
    assert.notEqual((await service.getRules("org_c")).calendarMode, "calcom");
  });

  it("refuses a malformed key without contacting Cal.com", async () => {
    const { store, service } = await business("org_c");
    const fake = createFakeCalcom({ slots: [] });
    const result = await connectCalcom({ store, service, fetchImpl: fake.fetch, env: {} }, { organizationId: "org_c", apiKey: "not a key" });
    assert.deepEqual(result, { ok: false, code: "invalid_key_format" });
    assert.equal(fake.requests.length, 0);
  });

  it("with several event types, the business must say which is which", async () => {
    const { store, service } = await business("org_c");
    const fake = createFakeCalcom({ slots: [], eventTypes: [{ id: 11, title: "A" }, { id: 12, title: "B" }] });
    const deps = { store, service, fetchImpl: fake.fetch, env: {} };
    assert.deepEqual(await connectCalcom(deps, { organizationId: "org_c", apiKey: KEY }), { ok: false, code: "mapping_required" });
    const ok = await connectCalcom(deps, {
      organizationId: "org_c",
      apiKey: KEY,
      eventTypes: [{ eventTypeId: 11 }, { eventTypeId: 12, serviceId: "svc_drain", technicianId: "t_alex" }],
    });
    assert.equal(ok.ok, true);
  });

  it("a mapping can only point at this business's own services and specialists, and at the key's own event types", async () => {
    const { store, service } = await business("org_c");
    const fake = createFakeCalcom({ slots: [] });
    const deps = { store, service, fetchImpl: fake.fetch, env: {} };
    const code = async (eventTypes: Parameters<typeof connectCalcom>[1]["eventTypes"]) =>
      (await connectCalcom(deps, { organizationId: "org_c", apiKey: KEY, eventTypes }) as { code?: string }).code;
    assert.equal(await code([{ eventTypeId: 999 }]), "unknown_event_type");
    assert.equal(await code([{ eventTypeId: 11, serviceId: "svc_of_another_business" }]), "unknown_service");
    assert.equal(await code([{ eventTypeId: 11, technicianId: "t_of_another_business" }]), "unknown_technician");
    assert.equal(await code([{ eventTypeId: 11 }, { eventTypeId: 11 }]), "duplicate_mapping");
    assert.equal(await store.getCalcomConnection("org_c"), null);
  });

  it("disconnecting deletes the stored key and returns the business to its own calendar", async () => {
    const { store, service } = await business("org_c");
    const fake = createFakeCalcom({ slots: [] });
    await connectCalcom({ store, service, fetchImpl: fake.fetch, env: {} }, { organizationId: "org_c", apiKey: KEY });
    await service.disconnect("org_c");
    assert.equal(await store.getCalcomConnection("org_c"), null);
    assert.equal((await service.getRules("org_c")).calendarMode, "simulated");
  });

  it("one business's connection is invisible to another", async () => {
    const { store, service } = await business("org_a");
    const fake = createFakeCalcom({ slots: [] });
    await connectCalcom({ store, service, fetchImpl: fake.fetch, env: {} }, { organizationId: "org_a", apiKey: KEY });
    assert.equal(await store.getCalcomConnection("org_b"), null);
    assert.deepEqual(await store.listCalcomOrganizations(10), ["org_a"]);
  });
});
