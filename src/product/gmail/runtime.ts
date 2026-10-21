import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import {
  getNotificationService,
  getNotificationStore,
} from "@/product/notifications/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { createPostgresGmailStore } from "./postgres-store";
import { createMemoryGmailStore, type GmailStore } from "./store";
import { syncGmailAccount, type SyncResult, type SyncTrigger } from "./sync";
import {
  gmailConfigured,
  gmailPushConfigured,
  gmailWatchActive,
  readGmailEnv,
} from "./oauth";
import type { GmailAccount, GmailPublicStatus } from "./types";

const globalForGmail = globalThis as unknown as {
  __tradecatchGmail?: GmailStore;
};

export function getGmailStore(): GmailStore {
  if (!globalForGmail.__tradecatchGmail) {
    const url = process.env.DATABASE_URL?.trim();
    const wantDurable =
      isDurableMissedCallStoreConfigured() ||
      process.env.SAAS_DURABLE_STORE === "1";
    if (wantDurable && url)
      globalForGmail.__tradecatchGmail = createPostgresGmailStore(url);
    else if (wantDurable && !url)
      throw new Error("[gmail] Durable store requires DATABASE_URL");
    else if (
      isProductionRuntime() &&
      process.env.SAAS_REQUIRE_DURABLE === "1"
    ) {
      throw new Error(
        "[gmail] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
      );
    } else
      globalForGmail.__tradecatchGmail = createMemoryGmailStore(
        getNotificationStore(),
      );
  }
  return globalForGmail.__tradecatchGmail;
}

export function resetGmailRuntimeForTests() {
  delete globalForGmail.__tradecatchGmail;
}

export async function processGmailAlerts() {
  // The dedicated Gmail scheduler must not activate unrelated automation jobs.
  return getNotificationService().processDue(25, "gmail_reply");
}

/** Background triggers must not keep syncing for a suspended workspace or a removed member. */
export async function isAccountActive(account: GmailAccount): Promise<boolean> {
  const saas = getSaasStore();
  const [organization, membership] = await Promise.all([
    saas.getOrganization(account.organizationId),
    saas.getMembership(account.organizationId, account.userId),
  ]);
  return Boolean(
    organization && organization.status === "active" && membership,
  );
}

export type ConnectedSyncResult =
  SyncResult | { ok: false; error: "not_connected"; skipped: true };

export async function syncConnectedGmail(
  organizationId: string,
  userId: string,
  trigger: SyncTrigger = "auto",
): Promise<ConnectedSyncResult> {
  const store = getGmailStore();
  const account = await store.getAccount(organizationId, userId);
  if (!account) return { ok: false, error: "not_connected", skipped: true };
  const result = await syncGmailAccount({
    account,
    store,
    env: readGmailEnv(),
    trigger,
  });
  // Import and queuing are atomic. Provider/fan-out failures can safely retry
  // from the durable outbox without pretending the mailbox import failed.
  try {
    await processGmailAlerts();
  } catch {
    console.warn("[gmail] Alert delivery deferred");
  }
  return result;
}

/** Cron fallback: the oldest-attempted connected mailboxes first, a few at a time. */
export async function syncAccountsDue(limit = 2, now = new Date()) {
  limit = Number.isFinite(limit)
    ? Math.max(1, Math.min(25, Math.trunc(limit)))
    : 2;
  const store = getGmailStore();
  const due = await store.listAccountsDue({
    nowIso: now.toISOString(),
    staleBeforeIso: new Date(
      now.getTime() - (readGmailEnv().testMinGapMs ?? 5 * 60_000),
    ).toISOString(),
    limit: limit + 1,
  });
  const summary = {
    attempted: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    added: 0,
    batchLimit: limit,
    capacityLimited: due.length > limit,
    delayedInBatch: 0,
    oldestSuccessfulSyncAgeSeconds: 0,
  };
  const started = Date.now();
  for (const account of due.slice(0, limit)) {
    if (Date.now() - started > 20_000) {
      summary.capacityLimited = true;
      break;
    }
    summary.attempted += 1;
    const age = Math.max(
      0,
      Math.floor(
        (now.getTime() - Date.parse(account.lastSyncAt || account.createdAt)) /
          1000,
      ),
    );
    summary.oldestSuccessfulSyncAgeSeconds = Math.max(
      summary.oldestSuccessfulSyncAgeSeconds,
      age,
    );
    if (age > 15 * 60) summary.delayedInBatch += 1;
    try {
      if (!(await isAccountActive(account))) {
        // Stamp the attempt so inactive workspaces rotate to the back of the queue
        // instead of starving everyone behind them.
        await store.updateAccount(account.id, {
          lastAttemptAt: now.toISOString(),
        });
        summary.skipped += 1;
        continue;
      }
      const result = await syncGmailAccount({
        account,
        store,
        env: readGmailEnv(),
        now,
        trigger: "cron",
      });
      if (result.ok) {
        summary.synced += 1;
        if (!result.skipped) summary.added += result.added;
      } else summary.failed += 1;
    } catch {
      summary.failed += 1;
      console.warn("[gmail] cron sync failed");
    }
  }
  await processGmailAlerts();
  if (summary.capacityLimited || summary.delayedInBatch || summary.failed) {
    console.warn("[gmail] sync health", JSON.stringify(summary));
  }
  return summary;
}

/** Everything the browser may know about a mailbox. No token material, ever. */
export async function getGmailStatus(
  organizationId: string,
  userId: string,
): Promise<GmailPublicStatus> {
  const env = readGmailEnv();
  const store = getGmailStore();
  const account = await store.getAccount(organizationId, userId);
  return {
    configured: gmailConfigured(env),
    pushConfigured: gmailPushConfigured(env),
    pushEnabled: gmailWatchActive(account, env),
    status: account?.status ?? "not_connected",
    email: account?.email ?? null,
    lastSyncAt: account?.lastSyncAt ?? null,
    lastError: account?.lastError ?? null,
    unread: account ? await store.countUnread(organizationId, userId) : 0,
  };
}
