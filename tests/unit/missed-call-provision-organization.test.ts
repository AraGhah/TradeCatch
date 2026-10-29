import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import { provisionOrganizationSmsNumber } from "../../src/product/missed-call/provision-organization";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { NumberProvisioningError } from "../../src/product/missed-call/number-provisioning";

const env = {
  NODE_ENV: "test",
  TWILIO_ACCOUNT_SID: "AC_test",
  TWILIO_AUTH_TOKEN: "token_test",
  MISSED_CALL_PUBLIC_WEBHOOK_BASE: "https://tradecatch.ca",
} as unknown as NodeJS.ProcessEnv;

function org(overrides: Partial<{
  id: string;
  name: string;
  timezone: string;
  phoneE164: string | null;
  missedCallClientId: string | null;
}> = {}) {
  return {
    id: "org_1",
    name: "Bea's Plumbing",
    timezone: "America/Toronto",
    phoneE164: "+14162010199",
    missedCallClientId: null,
    ...overrides,
  };
}

function mockTwilioFetch(options: {
  searchStatus?: number;
  purchaseStatus?: number;
  releaseStatus?: number;
  releaseCalls?: string[];
} = {}) {
  mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("AvailablePhoneNumbers")) {
        if (options.searchStatus && options.searchStatus >= 400) {
          return new Response("search failed", { status: options.searchStatus });
        }
        return Response.json({
          available_phone_numbers: [
            { phone_number: "+15142010188", friendly_name: "(514) 201-0188" },
          ],
        });
      }
      if (
        path.includes("IncomingPhoneNumbers") &&
        init?.method === "DELETE"
      ) {
        options.releaseCalls?.push(path);
        if (options.releaseStatus && options.releaseStatus >= 400) {
          return new Response("release failed", { status: options.releaseStatus });
        }
        return new Response(null, { status: 204 });
      }
      if (path.includes("IncomingPhoneNumbers")) {
        if (options.purchaseStatus && options.purchaseStatus >= 400) {
          return new Response("purchase failed", { status: options.purchaseStatus });
        }
        return Response.json({ sid: "PN123", phone_number: "+15142010188" });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  );
}

afterEach(() => mock.restoreAll());

describe("provisionOrganizationSmsNumber", () => {
  it("refuses an organization that is already linked, without calling Twilio", async () => {
    const fetchSpy = mock.method(globalThis, "fetch", async () => {
      throw new Error("must not call Twilio");
    });
    const store = createMemoryStore();
    await assert.rejects(
      () =>
        provisionOrganizationSmsNumber(
          { store, linkMissedCallClient: async () => null, env },
          { organization: org({ missedCallClientId: "client_existing" }) },
        ),
      NumberProvisioningError,
    );
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it("refuses an organization with no business phone number, without calling Twilio", async () => {
    const fetchSpy = mock.method(globalThis, "fetch", async () => {
      throw new Error("must not call Twilio");
    });
    const store = createMemoryStore();
    await assert.rejects(
      () =>
        provisionOrganizationSmsNumber(
          { store, linkMissedCallClient: async () => null, env },
          { organization: org({ phoneE164: null }) },
        ),
      NumberProvisioningError,
    );
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it("purchases a number, saves a valid client, and links the organization", async () => {
    mockTwilioFetch();
    const store = createMemoryStore();
    const linked: { organizationId: string; clientId: string }[] = [];
    const result = await provisionOrganizationSmsNumber(
      {
        store,
        linkMissedCallClient: async (organizationId, clientId) => {
          linked.push({ organizationId, clientId });
          return null;
        },
        env,
      },
      { organization: org() },
    );
    assert.equal(result.smsFromNumber, "+15142010188");
    assert.equal(result.clientAccountId, "org_org_1");
    assert.deepEqual(linked, [
      { organizationId: "org_1", clientId: "org_org_1" },
    ]);
    const saved = await store.getClient("org_org_1");
    assert.ok(saved);
    assert.equal(saved!.smsFromNumber, "+15142010188");
    assert.equal(saved!.technicianRoster[0]!.phone, "+14162010199");
    assert.equal(saved!.humanReviewPhone, "+14162010199");
  });

  it("releases the purchased number if saving the client fails", async () => {
    const releaseCalls: string[] = [];
    mockTwilioFetch({ releaseCalls });
    const store = {
      ...createMemoryStore(),
      saveClient: async () => {
        throw new Error("db write failed");
      },
    };
    await assert.rejects(() =>
      provisionOrganizationSmsNumber(
        { store, linkMissedCallClient: async () => null, env },
        { organization: org() },
      ),
    );
    assert.equal(releaseCalls.length, 1);
  });

  it("releases the purchased number if linking the organization fails", async () => {
    const releaseCalls: string[] = [];
    mockTwilioFetch({ releaseCalls });
    const store = createMemoryStore();
    await assert.rejects(() =>
      provisionOrganizationSmsNumber(
        {
          store,
          linkMissedCallClient: async () => {
            throw new Error("link failed");
          },
          env,
        },
        { organization: org() },
      ),
    );
    assert.equal(releaseCalls.length, 1);
    // The client was saved before the link failed — still proves the
    // purchased number itself was released, matching the test's intent.
    assert.ok(await store.getClient("org_org_1"));
  });

  it("releases the purchased number when the built client fails production validation", async () => {
    const releaseCalls: string[] = [];
    mockTwilioFetch({ releaseCalls });
    const store = createMemoryStore();
    await assert.rejects(() =>
      provisionOrganizationSmsNumber(
        { store, linkMissedCallClient: async () => null, env },
        // Malformed business phone slips past this test's own org() shape
        // but not E.164 validation inside validateClientConfig.
        { organization: org({ phoneE164: "416-201-0199" }) },
      ),
    );
    assert.equal(releaseCalls.length, 1);
  });

  it("surfaces a clear error when no numbers match the search", async () => {
    mock.method(globalThis, "fetch", async (url: unknown) => {
      if (String(url).includes("AvailablePhoneNumbers")) {
        return Response.json({ available_phone_numbers: [] });
      }
      throw new Error("must not purchase when nothing was found");
    });
    const store = createMemoryStore();
    await assert.rejects(
      () =>
        provisionOrganizationSmsNumber(
          { store, linkMissedCallClient: async () => null, env },
          { organization: org() },
        ),
      NumberProvisioningError,
    );
  });
});
