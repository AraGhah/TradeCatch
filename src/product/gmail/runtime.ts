import { createId } from "@/lib/id";
import { isDurableMissedCallStoreConfigured, isProductionRuntime } from "@/lib/config";
import { getNotificationService, getNotificationStore } from "@/product/notifications/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { createPostgresGmailStore } from "./postgres-store";
import { createMemoryGmailStore, type GmailStore } from "./store";
import { syncGmailAccount, type SyncResult, type SyncTrigger } from "./sync";
import { gmailConfigured, gmailPushConfigured, readGmailEnv } from "./oauth";
import type { GmailAccount, GmailPublicStatus, ParsedGmailMessage } from "./types";

const globalForGmail = globalThis as unknown as { __tradecatchGmail?: GmailStore };

export function getGmailStore(): GmailStore {
  if (!globalForGmail.__tradecatchGmail) {
    const url = process.env.DATABASE_URL?.trim();
    const wantDurable = isDurableMissedCallStoreConfigured() || process.env.SAAS_DURABLE_STORE === "1";
    if (wantDurable && url) globalForGmail.__tradecatchGmail = createPostgresGmailStore(url);
    else if (wantDurable && !url) throw new Error("[gmail] Durable store requires DATABASE_URL");
    else if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
      throw new Error("[gmail] Refusing memory store when SAAS_REQUIRE_DURABLE=1");
    } else globalForGmail.__tradecatchGmail = createMemoryGmailStore();
  }
  return globalForGmail.__tradecatchGmail;
}

export function resetGmailRuntimeForTests() {
  delete globalForGmail.__tradecatchGmail;
}

const COPY = {
  en: { title: "New customer email" },
  fr: { title: "Nouveau courriel client" },
} as const;

/**
 * In-app alert for the mailbox owner only. It deliberately does not go through
 * the org-wide event fan-out: other members must not learn who wrote to a
 * mailbox that is not theirs.
 */
async function notifyCustomerEmail(message: ParsedGmailMessage & { id: string }, account: GmailAccount) {
  const user = await getSaasStore().getUser(account.userId);
  const lang = user?.locale === "fr" ? "fr" : "en";
  try {
    const prefs = await getNotificationService().getPreferences(account.organizationId, account.userId, lang);
    if (prefs.categories.replies?.inApp === false) return;
  } catch {
    // No preferences yet or store unavailable: default to notifying.
  }
  const notes = getNotificationStore();
  const key = `gmail:${account.id}:${message.gmailId}`;
  if (await notes.findNotificationByKey(account.organizationId, key)) return;
  const id = createId("ntf");
  const at = new Date().toISOString();
  const sender = message.fromName || message.fromEmail;
  const subject = message.subject.trim();
  await notes.saveNotification({
    id,
    organizationId: account.organizationId,
    type: "customer_message",
    title: COPY[lang].title,
    message: (subject ? `${sender} — ${subject}` : sender).slice(0, 200),
    priority: "normal",
    href: `/app/mail/${message.id}`,
    idempotencyKey: key,
    simulated: false,
    createdAt: at,
    updatedAt: at,
  });
  await notes.saveRecipient({
    id: createId("ntr"),
    notificationId: id,
    organizationId: account.organizationId,
    userId: account.userId,
  });
}

/** Background triggers must not keep syncing for a suspended workspace or a removed member. */
export async function isAccountActive(account: GmailAccount): Promise<boolean> {
  const saas = getSaasStore();
  const [organization, membership] = await Promise.all([
    saas.getOrganization(account.organizationId),
    saas.getMembership(account.organizationId, account.userId),
  ]);
  return Boolean(organization && organization.status === "active" && membership);
}

export type ConnectedSyncResult = SyncResult | { ok: false; error: "not_connected"; skipped: true };

export async function syncConnectedGmail(
  organizationId: string,
  userId: string,
  trigger: SyncTrigger = "auto",
): Promise<ConnectedSyncResult> {
  const store = getGmailStore();
  const account = await store.getAccount(organizationId, userId);
  if (!account) return { ok: false, error: "not_connected", skipped: true };
  return syncGmailAccount({
    account,
    store,
    env: readGmailEnv(),
    trigger,
    onCustomerEmail: notifyCustomerEmail,
  });
}

/** Cron fallback: the oldest-attempted connected mailboxes first, a few at a time. */
export async function syncAccountsDue(limit = 10, now = new Date()) {
  const store = getGmailStore();
  const due = await store.listAccountsDue({
    nowIso: now.toISOString(),
    staleBeforeIso: new Date(now.getTime() - (readGmailEnv().testMinGapMs ?? 10 * 60_000)).toISOString(),
    limit,
  });
  const summary = { attempted: due.length, synced: 0, failed: 0, skipped: 0, added: 0 };
  for (const account of due) {
    try {
      if (!(await isAccountActive(account))) {
        // Stamp the attempt so inactive workspaces rotate to the back of the queue
        // instead of starving everyone behind them.
        await store.updateAccount(account.id, { lastAttemptAt: now.toISOString() });
        summary.skipped += 1;
        continue;
      }
      const result = await syncGmailAccount({
        account,
        store,
        env: readGmailEnv(),
        now,
        trigger: "cron",
        onCustomerEmail: notifyCustomerEmail,
      });
      if (result.ok) {
        summary.synced += 1;
        if (!result.skipped) summary.added += result.added;
      } else summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      console.warn("[gmail] cron sync failed", error instanceof Error ? error.message : "unknown");
    }
  }
  return summary;
}

/** Everything the browser may know about a mailbox. No token material, ever. */
export async function getGmailStatus(organizationId: string, userId: string): Promise<GmailPublicStatus> {
  const env = readGmailEnv();
  const store = getGmailStore();
  const account = await store.getAccount(organizationId, userId);
  return {
    configured: gmailConfigured(env),
    pushEnabled: gmailPushConfigured(env),
    status: account?.status ?? "not_connected",
    email: account?.email ?? null,
    lastSyncAt: account?.lastSyncAt ?? null,
    lastError: account?.lastError ?? null,
    unread: account ? await store.countUnread(organizationId, userId) : 0,
  };
}
