import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSchedulingService,
  createSimulatedCalendar,
} from "../../src/product/scheduling/service";
import {
  createMemorySchedulingStore,
  type SchedulingStore,
} from "../../src/product/scheduling/store";

/**
 * KAN-19 (CAL-11, CAL-12): a business gets its default services and its one
 * technician the first time anything asks for them. Several requests arrive
 * together on a new calendar (the dashboard asks four questions at once), so
 * that first setup must happen once. A second technician is a second person
 * who can take the same hour: two customers would both be confirmed.
 */

const now = () => new Date("2026-10-16T12:00:00Z");
// Monday 10:00 in Toronto, inside the default hours and the booking window.
const MONDAY_TEN = "2026-10-19T14:00:00Z";

function serviceOn(store: SchedulingStore) {
  return createSchedulingService({
    store,
    now,
    calendar: async () => createSimulatedCalendar(),
  });
}

async function setupOf(store: SchedulingStore, organizationId: string) {
  const [services, technicians] = await Promise.all([
    store.listServices(organizationId),
    store.listTechnicians(organizationId),
  ]);
  return { services, technicians };
}

test("the dashboard's four simultaneous reads set a new business up once", async () => {
  const store = createMemorySchedulingStore();
  const service = serviceOn(store);
  const org = "org_seed_reads";

  await Promise.all([
    service.list(org),
    service.listTechnicians(org),
    service.connectionStatus(org),
    service.getRules(org),
  ]);

  const { services, technicians } = await setupOf(store, org);
  assert.equal(technicians.length, 1, "one technician, not one per request");
  assert.equal(services.length, 5);
  assert.equal(
    new Set(services.map((row) => row.name)).size,
    5,
    "each default service appears once",
  );
});

test("requests handled by different service instances also set a business up once", async () => {
  // Every request builds its own service object over the one shared store.
  const store = createMemorySchedulingStore();
  const org = "org_seed_instances";

  await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      index % 2 === 0
        ? serviceOn(store).listTechnicians(org)
        : serviceOn(store).listServices(org),
    ),
  );

  const { services, technicians } = await setupOf(store, org);
  assert.equal(technicians.length, 1);
  assert.equal(services.length, 5);
});

test("setting up a business again changes nothing, even when two workers both found it empty", async () => {
  // Another server instance cannot share this process's guard, so the rows
  // themselves must be the same rows each time.
  const real = createMemorySchedulingStore();
  let staleReads = 4;
  const store: SchedulingStore = {
    ...real,
    async getRules(organizationId) {
      if (staleReads > 0) {
        staleReads -= 1;
        return null;
      }
      return real.getRules(organizationId);
    },
  };
  const org = "org_seed_twice";

  await serviceOn(store).getRules(org);
  await serviceOn(store).getRules(org);

  const { services, technicians } = await setupOf(real, org);
  assert.equal(technicians.length, 1);
  assert.equal(services.length, 5);
});

test("five people grabbing one time on a new calendar: exactly one is confirmed", async () => {
  const store = createMemorySchedulingStore();
  const org = "org_seed_race";
  // What opening the calendar does first, then the race.
  const opening = serviceOn(store);
  await Promise.all([
    opening.list(org),
    opening.listTechnicians(org),
    opening.connectionStatus(org),
    opening.getRules(org),
  ]);

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      serviceOn(store).book({
        organizationId: org,
        startAt: MONDAY_TEN,
        customerName: `Racer ${index}`,
        source: "dashboard",
        requestIfUnavailable: false,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.confirmed).length, 1);
  assert.deepEqual(
    results
      .filter((result) => !result.confirmed)
      .map((result) => result.reason),
    ["conflict", "conflict", "conflict", "conflict"],
  );
  const rows = await store.listAppointments(org);
  assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
});

test("a second booking of a taken time is refused, one after the other", async () => {
  const store = createMemorySchedulingStore();
  const org = "org_seed_sequence";
  const first = await serviceOn(store).book({
    organizationId: org,
    startAt: MONDAY_TEN,
    customerName: "First In",
    source: "dashboard",
    requestIfUnavailable: false,
  });
  assert.equal(first.confirmed, true);
  const second = await serviceOn(store).book({
    organizationId: org,
    startAt: MONDAY_TEN,
    customerName: "Second In",
    source: "dashboard",
    requestIfUnavailable: false,
  });
  assert.equal(second.confirmed, false);
  assert.equal(second.reason, "conflict");
});
