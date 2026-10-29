import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { createMemoryGrowthStore, createGrowthServices } from "../../src/product/growth";

afterEach(() => mock.restoreAll());

describe("CrmWebhookEndpoint store", () => {
  it("creates, lists, updates and deletes endpoints scoped to an organization", async () => {
    const store = createMemoryGrowthStore();
    const created = await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://example.test/hooks/crm",
      label: "Main CRM",
      eventTypes: ["pipeline.won"],
    });
    assert.equal(created.active, true);

    const other = await store.createCrmWebhookEndpoint({
      organizationId: "org_b",
      url: "https://example.test/other",
      label: "Other org",
      eventTypes: [],
    });

    const listA = await store.listCrmWebhookEndpoints("org_a");
    assert.equal(listA.length, 1);
    assert.equal(listA[0]!.id, created.id);

    const updated = await store.updateCrmWebhookEndpoint(created.id, "org_a", {
      active: false,
    });
    assert.equal(updated?.active, false);

    assert.equal(
      await store.deleteCrmWebhookEndpoint(other.id, "org_a"),
      false,
    );
    assert.equal(
      await store.deleteCrmWebhookEndpoint(other.id, "org_b"),
      true,
    );
  });
});

function mockFetch(
  behavior: (url: string) => { ok: boolean; status?: number },
) {
  return mock.method(globalThis, "fetch", async (url: unknown) => {
    const result = behavior(String(url));
    return new Response(JSON.stringify({}), {
      status: result.ok ? 200 : (result.status ?? 500),
    });
  });
}

describe("syncCrm fan-out to advanced webhook endpoints", () => {
  it("sends to the legacy single webhook when no advanced endpoints exist", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.upsertOrgSettings("org_a", {
      crmWebhookUrl: "https://legacy.test/hook",
    });
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { ok: true };
    });

    const result = await services.syncCrm({
      organizationId: "org_a",
      eventType: "pipeline.won",
      data: { id: "1" },
    });
    assert.equal(result.forwarded, true);
    assert.deepEqual(calls, ["https://legacy.test/hook"]);
  });

  it("fans out to every active endpoint matching the event type", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://a.test/hook",
      label: "A",
      eventTypes: [], // all events
    });
    await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://b.test/hook",
      label: "B",
      eventTypes: ["pipeline.won"],
    });
    await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://c.test/hook",
      label: "C filtered out",
      eventTypes: ["pipeline.lost"],
    });
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { ok: true };
    });

    await services.syncCrm({
      organizationId: "org_a",
      eventType: "pipeline.won",
      data: { id: "1" },
    });
    assert.deepEqual(
      calls.sort(),
      ["https://a.test/hook", "https://b.test/hook"].sort(),
    );
  });

  it("skips an inactive endpoint", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const endpoint = await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://a.test/hook",
      label: "A",
      eventTypes: [],
    });
    await store.updateCrmWebhookEndpoint(endpoint.id, "org_a", {
      active: false,
    });
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { ok: true };
    });

    const result = await services.syncCrm({
      organizationId: "org_a",
      eventType: "pipeline.won",
      data: {},
    });
    assert.equal(result.forwarded, false);
    assert.equal(calls.length, 0);
  });

  it("enqueues a DLQ entry tagged with the failing endpoint id, and still delivers to the others", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const good = await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://good.test/hook",
      label: "Good",
      eventTypes: [],
    });
    const bad = await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://bad.test/hook",
      label: "Bad",
      eventTypes: [],
    });
    mockFetch((url) => ({ ok: url.includes("good.test") }));

    const result = await services.syncCrm({
      organizationId: "org_a",
      eventType: "pipeline.won",
      data: { id: "1" },
    });
    assert.equal(result.forwarded, false);

    const dlq = await store.listCrmDlq("org_a");
    assert.equal(dlq.length, 1);
    assert.equal(dlq[0]!.endpointId, bad.id);
    assert.notEqual(dlq[0]!.endpointId, good.id);
  });
});

describe("processCrmDlq retries against the correct target", () => {
  it("retries a legacy (no endpointId) item against the org's crmWebhookUrl", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.upsertOrgSettings("org_a", {
      crmWebhookUrl: "https://legacy.test/hook",
    });
    await store.enqueueCrmDlq({
      organizationId: "org_a",
      eventType: "pipeline.won",
      payload: { id: "1" },
      attempts: 1,
    });
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { ok: true };
    });

    const result = await services.processCrmDlq();
    assert.equal(result.resolved, 1);
    assert.deepEqual(calls, ["https://legacy.test/hook"]);
  });

  it("retries an endpoint-tagged item against that specific endpoint's current url", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const endpoint = await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://endpoint.test/hook",
      label: "Endpoint",
      eventTypes: [],
    });
    await store.enqueueCrmDlq({
      organizationId: "org_a",
      eventType: "pipeline.won",
      payload: { id: "1" },
      attempts: 1,
      endpointId: endpoint.id,
    });
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return { ok: true };
    });

    const result = await services.processCrmDlq();
    assert.equal(result.resolved, 1);
    assert.deepEqual(calls, ["https://endpoint.test/hook"]);
  });

  it("fails closed (missing_crm_webhook) when the tagged endpoint was deleted", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.enqueueCrmDlq({
      organizationId: "org_a",
      eventType: "pipeline.won",
      payload: { id: "1" },
      attempts: 1,
      endpointId: "webhook_gone",
    });
    const fetchSpy = mockFetch(() => ({ ok: true }));

    const result = await services.processCrmDlq();
    assert.equal(result.failed, 1);
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it("fails closed when the tagged endpoint has since been deactivated", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const endpoint = await store.createCrmWebhookEndpoint({
      organizationId: "org_a",
      url: "https://endpoint.test/hook",
      label: "Endpoint",
      eventTypes: [],
    });
    await store.updateCrmWebhookEndpoint(endpoint.id, "org_a", {
      active: false,
    });
    await store.enqueueCrmDlq({
      organizationId: "org_a",
      eventType: "pipeline.won",
      payload: { id: "1" },
      attempts: 1,
      endpointId: endpoint.id,
    });
    const fetchSpy = mockFetch(() => ({ ok: true }));

    const result = await services.processCrmDlq();
    assert.equal(result.failed, 1);
    assert.equal(fetchSpy.mock.callCount(), 0);
  });
});
