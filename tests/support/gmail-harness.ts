import { createId } from "../../src/lib/id";
import { exchangeGmailCode, sealGmailTokens, type GmailEnv } from "../../src/product/gmail/oauth";
import { createMemoryGmailStore, type GmailStore } from "../../src/product/gmail/store";
import { syncGmailAccount, type SyncTrigger } from "../../src/product/gmail/sync";
import type { GmailAccount, ParsedGmailMessage } from "../../src/product/gmail/types";
import { FakeGoogle } from "./fake-google";

export const TEST_ENV: GmailEnv = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/api/app/gmail/callback",
  authSecret: "unit-test-auth-secret-0123456789abcdef",
  siteUrl: "http://localhost:3000",
  apiBase: "http://fake.google/gmail/v1/users/me",
  tokenUrl: "http://fake.google/token",
  revokeUrl: "http://fake.google/revoke",
};

export const T0 = Date.parse("2026-10-18T12:00:00.000Z");
/** `minutes` after the test epoch, for driving the sync throttle deterministically. */
export const at = (minutes: number) => new Date(T0 + minutes * 60_000);

export type Harness = {
  google: FakeGoogle;
  store: GmailStore;
  env: GmailEnv;
  alerts: (ParsedGmailMessage & { id: string })[];
  /** Connects a mailbox the way the OAuth callback does. */
  connect(email: string, owner?: { organizationId: string; userId: string }): Promise<GmailAccount>;
  account(owner?: { organizationId: string; userId: string }): Promise<GmailAccount>;
  sync(minutes: number, options?: { trigger?: SyncTrigger; owner?: { organizationId: string; userId: string } }): ReturnType<typeof syncGmailAccount>;
};

const DEFAULT_OWNER = { organizationId: "org_a", userId: "usr_a" };

export function createHarness(store: GmailStore = createMemoryGmailStore()): Harness {
  const google = new FakeGoogle();
  const alerts: Harness["alerts"] = [];
  const fetchImpl = google.fetchImpl();

  const harness: Harness = {
    google,
    store,
    env: TEST_ENV,
    alerts,
    async connect(email, owner = DEFAULT_OWNER) {
      const tokens = await exchangeGmailCode(google.codeFor(email), TEST_ENV, fetchImpl);
      const now = new Date(T0).toISOString();
      const row: GmailAccount = {
        id: createId("gac"),
        ...owner,
        email,
        status: "connected",
        tokenCiphertext: sealGmailTokens(tokens, TEST_ENV),
        historyId: null,
        watchExpiration: null,
        lastSyncAt: null,
        lastAttemptAt: null,
        nextSyncAt: null,
        failureCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      await store.saveAccount(row);
      return row;
    },
    async account(owner = DEFAULT_OWNER) {
      const row = await store.getAccount(owner.organizationId, owner.userId);
      if (!row) throw new Error("no account");
      return row;
    },
    async sync(minutes, options = {}) {
      return syncGmailAccount({
        account: await harness.account(options.owner),
        store,
        env: TEST_ENV,
        now: at(minutes),
        trigger: options.trigger ?? "auto",
        fetchImpl,
        onCustomerEmail: async (message) => {
          alerts.push(message);
        },
      });
    },
  };
  return harness;
}
