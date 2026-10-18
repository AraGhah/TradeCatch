import { GmailApiError, backoffMs, failureFromResponse, toGmailError } from "./errors";
import { newMessageIds, parseGmailMessage, type GmailApiMessage } from "./parse";
import {
  accessTokenFresh,
  gmailPushConfigured,
  openGmailTokens,
  refreshGmailTokens,
  sealGmailTokens,
  type GmailEnv,
  type GmailTokens,
} from "./oauth";
import type { GmailStore } from "./store";
import type { GmailAccount, GmailFailureKind, ParsedGmailMessage } from "./types";

type FetchImpl = typeof fetch;

/** Who asked for the sync; decides how soon after the last attempt it may run again. */
export type SyncTrigger = "auto" | "manual" | "push" | "cron";

export type SyncResult =
  | { ok: true; added: number; skipped: boolean; more: boolean }
  | { ok: false; error: GmailFailureKind; skipped?: boolean };

const BOOTSTRAP_LIMIT = 25;
const MAX_FETCH = 200;
const HISTORY_PAGE_SIZE = 100;
const MAX_HISTORY_PAGES = 10;
const FETCH_CONCURRENCY = 4;
const LEASE_MS = 90_000;
const REQUEST_TIMEOUT_MS = 15_000;
const WATCH_RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

const MIN_GAP_MS: Record<SyncTrigger, number> = {
  auto: 45_000,
  manual: 8_000,
  push: 2_000,
  cron: 5 * 60_000,
};

/** Failures where even a manual retry would just be refused by Google again. */
const HARD_BACKOFF: string[] = ["rate_limited", "config_error"];

export function syncSkipReason(
  account: Pick<GmailAccount, "lastAttemptAt" | "nextSyncAt" | "lastError">,
  nowMs: number,
  trigger: SyncTrigger,
  gapOverrideMs?: number,
): "backoff" | "recent" | null {
  if (account.nextSyncAt && Date.parse(account.nextSyncAt) > nowMs) {
    if (trigger !== "manual" || HARD_BACKOFF.includes(account.lastError || "")) return "backoff";
  }
  if (account.lastAttemptAt) {
    const since = nowMs - Date.parse(account.lastAttemptAt);
    if (Number.isFinite(since) && since < (gapOverrideMs ?? MIN_GAP_MS[trigger])) return "recent";
  }
  return null;
}

type GmailClient = {
  json<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T>;
  tokens(): GmailTokens;
};

function createClient(input: {
  tokens: GmailTokens;
  env: GmailEnv;
  fetchImpl: FetchImpl;
  nowMs: () => number;
  onTokens: (tokens: GmailTokens) => Promise<void>;
}): GmailClient {
  let tokens = input.tokens;
  const base = input.env.apiBase!;

  async function refresh() {
    tokens = await refreshGmailTokens(tokens, input.env, input.fetchImpl, input.nowMs());
    await input.onTokens(tokens);
  }

  async function send(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await input.fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${tokens.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GmailApiError("sync_failed", 0, error instanceof Error ? error.message : "network");
    }
    return { response, text: await response.text() };
  }

  return {
    tokens: () => tokens,
    async json<T>(path: string, init?: RequestInit) {
      if (!accessTokenFresh(tokens, input.nowMs())) await refresh();
      let result = await send(path, init);
      if (result.response.status === 401) {
        // The token looked fresh but Google disagrees; one forced refresh, then give up.
        await refresh();
        result = await send(path, init);
      }
      if (!result.response.ok) {
        throw failureFromResponse(
          result.response.status,
          result.text,
          result.response.headers.get("retry-after"),
        );
      }
      try {
        return (result.text ? JSON.parse(result.text) : {}) as T;
      } catch {
        throw new GmailApiError("sync_failed", result.response.status, "response was not JSON");
      }
    },
  };
}

type HistoryRecord = {
  id?: string;
  messagesAdded?: { message?: { id?: string; labelIds?: string[] } }[];
  messagesDeleted?: { message?: { id?: string } }[];
  labelsAdded?: { message?: { id?: string }; labelIds?: string[] }[];
  labelsRemoved?: { message?: { id?: string }; labelIds?: string[] }[];
};

type HistoryDelta = {
  added: string[];
  unread: Map<string, boolean>;
  removed: Set<string>;
  historyId: string;
  more: boolean;
};

async function readHistory(client: GmailClient, startHistoryId: string): Promise<HistoryDelta> {
  const added = new Set<string>();
  const unread = new Map<string, boolean>();
  const removed = new Set<string>();
  let latest = startHistoryId;
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      maxResults: String(HISTORY_PAGE_SIZE),
    });
    for (const type of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) {
      params.append("historyTypes", type);
    }
    if (pageToken) params.set("pageToken", pageToken);
    const page = await client.json<{
      history?: HistoryRecord[];
      nextPageToken?: string;
      historyId?: string;
    }>(`/history?${params.toString()}`);

    for (const record of page.history || []) {
      for (const item of record.messagesAdded || []) {
        const id = item.message?.id;
        if (id) {
          added.add(id);
          removed.delete(id);
        }
      }
      for (const item of record.messagesDeleted || []) {
        const id = item.message?.id;
        if (id) {
          added.delete(id);
          removed.add(id);
        }
      }
      for (const item of record.labelsAdded || []) {
        const id = item.message?.id;
        if (!id) continue;
        const labels = item.labelIds || [];
        if (labels.includes("TRASH") || labels.includes("SPAM")) {
          added.delete(id);
          removed.add(id);
        }
        if (labels.includes("UNREAD")) unread.set(id, true);
        if (labels.includes("INBOX")) {
          // Moved into the inbox (restored, un-spammed): treat as newly arrived.
          added.add(id);
          removed.delete(id);
        }
      }
      for (const item of record.labelsRemoved || []) {
        const id = item.message?.id;
        if (id && (item.labelIds || []).includes("UNREAD")) unread.set(id, false);
      }
      if (record.id) latest = record.id;
    }

    pageToken = page.nextPageToken;
    pages += 1;
    // Only a fully drained listing may jump to the mailbox's current history id.
    if (!pageToken && page.historyId) latest = page.historyId;
  } while (pageToken && pages < MAX_HISTORY_PAGES);

  return { added: [...added], unread, removed, historyId: latest, more: Boolean(pageToken) };
}

type ListedMessage = { id?: string; threadId?: string };

/**
 * Recent inbox mail, plus the user's own recent replies in those same
 * conversations so a thread is complete from the first sync. Inbox ids come
 * first: a reply is only stored once its conversation is known.
 */
async function listBootstrapIds(client: GmailClient): Promise<string[]> {
  const inbox = await client.json<{ messages?: ListedMessage[] }>(
    `/messages?maxResults=${BOOTSTRAP_LIMIT}&labelIds=INBOX`,
  );
  const received = (inbox.messages || []).filter((row) => row.id);
  const threads = new Set(received.map((row) => row.threadId).filter(Boolean));
  let replies: string[] = [];
  if (threads.size > 0) {
    const sent = await client.json<{ messages?: ListedMessage[] }>(
      `/messages?maxResults=${BOOTSTRAP_LIMIT}&labelIds=SENT`,
    );
    replies = (sent.messages || [])
      .filter((row) => row.id && row.threadId && threads.has(row.threadId))
      .map((row) => row.id!);
  }
  return [...received.map((row) => row.id!), ...replies];
}

async function mapLimited<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function watchDue(expiration: string | null, nowMs: number): boolean {
  if (!expiration) return true;
  return Date.parse(expiration) - nowMs < WATCH_RENEW_BEFORE_MS;
}

export async function syncGmailAccount(input: {
  account: GmailAccount;
  store: GmailStore;
  env: GmailEnv;
  now?: Date;
  trigger?: SyncTrigger;
  fetchImpl?: FetchImpl;
  /** Called once for each newly stored message that looks like a customer writing in. */
  onCustomerEmail?: (message: ParsedGmailMessage & { id: string }, account: GmailAccount) => Promise<void>;
}): Promise<SyncResult> {
  const { account, store } = input;
  const now = input.now ?? new Date();
  const trigger = input.trigger ?? "auto";

  if (account.status !== "connected" || !account.tokenCiphertext) {
    return { ok: false, error: "needs_reconnect" };
  }
  const skip = syncSkipReason(account, now.getTime(), trigger, input.env.testMinGapMs);
  if (skip === "backoff") {
    return { ok: false, error: (account.lastError as GmailFailureKind) || "sync_failed", skipped: true };
  }
  if (skip === "recent") return { ok: true, added: 0, skipped: true, more: false };
  if (!(await store.tryBeginSync(account.id, now, LEASE_MS))) {
    return { ok: true, added: 0, skipped: true, more: false };
  }

  try {
    return await run({ ...input, account, now, trigger });
  } finally {
    await store.endSync(account.id).catch(() => undefined);
  }
}

async function run(input: Parameters<typeof syncGmailAccount>[0] & { now: Date; trigger: SyncTrigger }): Promise<SyncResult> {
  const { account, store, env, now } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const nowIso = now.toISOString();

  // Recorded first so a crash mid-sync still counts as an attempt for throttling.
  await store.updateAccount(account.id, { lastAttemptAt: nowIso });

  let tokens: GmailTokens;
  try {
    tokens = openGmailTokens(account.tokenCiphertext!, env);
  } catch {
    // Sealed with a different AUTH_SECRET, or corrupted: only a fresh consent helps.
    await store.updateAccount(account.id, {
      status: "needs_reconnect",
      tokenCiphertext: null,
      lastError: "needs_reconnect",
      nextSyncAt: null,
    });
    return { ok: false, error: "needs_reconnect" };
  }

  const client = createClient({
    tokens,
    env,
    fetchImpl,
    nowMs: () => Date.now(),
    onTokens: async (next) => {
      await store.updateAccount(account.id, { tokenCiphertext: sealGmailTokens(next, env) });
    },
  });

  try {
    let mailbox = account.email || "";
    let historyId = account.historyId;
    let bootstrap = !historyId;
    let delta: HistoryDelta | null = null;

    if (historyId) {
      try {
        delta = await readHistory(client, historyId);
        historyId = delta.historyId;
      } catch (error) {
        // Google keeps history for about a week; older ids are gone. Start over
        // from the inbox listing instead of failing forever.
        if (!(error instanceof GmailApiError) || error.status !== 404) throw error;
        bootstrap = true;
        delta = null;
      }
    }

    let ids: string[];
    if (bootstrap) {
      const profile = await client.json<{ emailAddress?: string; historyId?: string }>("/profile");
      mailbox = profile.emailAddress || mailbox;
      // Taken before listing so mail arriving mid-listing is caught next time.
      historyId = profile.historyId || null;
      ids = await listBootstrapIds(client);
    } else {
      ids = delta?.added ?? [];
    }

    if (delta) {
      for (const [gmailId, value] of delta.unread) {
        if (!delta.removed.has(gmailId)) await store.setUnreadByGmailId(account.id, gmailId, value);
      }
      await store.deleteByGmailIds(account.id, [...delta.removed]);
    }

    const wanted = newMessageIds(new Set(), ids).filter((id) => !delta?.removed.has(id));
    const known = await store.existingGmailIds(account.id, wanted);
    const fresh = newMessageIds(known, wanted).slice(-MAX_FETCH);

    const loaded = await mapLimited(fresh, FETCH_CONCURRENCY, async (gmailId) => {
      try {
        return await client.json<GmailApiMessage>(`/messages/${encodeURIComponent(gmailId)}?format=full`);
      } catch (error) {
        // Deleted between the history entry and the fetch: nothing to import.
        if (error instanceof GmailApiError && error.status === 404) return null;
        throw error;
      }
    });

    // On the very first connect there is no "since", so old mail must not page the user.
    const notifyAfter = bootstrap ? Date.parse(account.lastSyncAt || "") : Number.NEGATIVE_INFINITY;
    let added = 0;
    for (const raw of loaded) {
      const parsed = raw ? parseGmailMessage(raw, mailbox) : null;
      if (!parsed) continue;
      if (parsed.direction === "outbound" && !(await store.threadKnown(account.id, parsed.threadId))) {
        continue;
      }
      const saved = await store.upsertMessage({
        ...parsed,
        organizationId: account.organizationId,
        userId: account.userId,
        accountId: account.id,
      });
      if (!saved.inserted) continue;
      added += 1;
      const recent = Date.parse(parsed.receivedAt) > notifyAfter;
      if (input.onCustomerEmail && parsed.important && parsed.unread && recent) {
        try {
          await input.onCustomerEmail({ ...parsed, id: saved.message.id }, account);
        } catch (error) {
          console.warn("[gmail] notification skipped", error instanceof Error ? error.message : "unknown");
        }
      }
    }

    let watchExpiration = account.watchExpiration;
    if (gmailPushConfigured(env) && watchDue(watchExpiration, now.getTime())) {
      try {
        const watch = await client.json<{ expiration?: string }>("/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicName: env.pubsubTopic,
            labelIds: ["INBOX"],
            labelFilterBehavior: "INCLUDE",
          }),
        });
        if (watch.expiration) watchExpiration = new Date(Number(watch.expiration)).toISOString();
      } catch (error) {
        // Push is an accelerator; polling and cron keep working without it.
        console.warn("[gmail] watch skipped", error instanceof Error ? error.message : "unknown");
      }
    }

    await store.updateAccount(account.id, {
      email: mailbox || null,
      historyId,
      watchExpiration,
      lastSyncAt: nowIso,
      lastError: null,
      failureCount: 0,
      nextSyncAt: null,
    });
    return { ok: true, added, skipped: false, more: Boolean(delta?.more) };
  } catch (error) {
    const failure = toGmailError(error);
    const failures = account.failureCount + 1;
    if (failure.kind === "needs_reconnect") {
      // Revoked or expired for good: drop the dead credentials, keep the mail.
      await store.updateAccount(account.id, {
        status: "needs_reconnect",
        tokenCiphertext: null,
        watchExpiration: null,
        lastError: failure.kind,
        failureCount: failures,
        nextSyncAt: null,
      });
    } else {
      await store.updateAccount(account.id, {
        lastError: failure.kind,
        failureCount: failures,
        nextSyncAt: new Date(now.getTime() + backoffMs(failure, failures)).toISOString(),
      });
    }
    return { ok: false, error: failure.kind };
  }
}

export async function downloadGmailAttachment(input: {
  tokens: GmailTokens;
  env: GmailEnv;
  gmailId: string;
  attachment: { attachmentId: string; partId: string };
  fetchImpl?: FetchImpl;
  onTokens?: (tokens: GmailTokens) => Promise<void>;
}): Promise<Buffer | null> {
  const client = createClient({
    tokens: input.tokens,
    env: input.env,
    fetchImpl: input.fetchImpl ?? fetch,
    nowMs: () => Date.now(),
    onTokens: async (next) => {
      await input.onTokens?.(next);
    },
  });
  const fetchPart = async (attachmentId: string) => {
    const body = await client.json<{ data?: string }>(
      `/messages/${encodeURIComponent(input.gmailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return body.data ? Buffer.from(body.data, "base64url") : null;
  };
  try {
    return await fetchPart(input.attachment.attachmentId);
  } catch (error) {
    // Attachment ids are not guaranteed stable between fetches; look it up again by part id.
    if (!(error instanceof GmailApiError) || ![400, 404].includes(error.status) || !input.attachment.partId) {
      throw error;
    }
  }
  const message = await client.json<GmailApiMessage>(
    `/messages/${encodeURIComponent(input.gmailId)}?format=full`,
  );
  const part = findPart(message.payload, input.attachment.partId);
  return part?.body?.attachmentId ? fetchPart(part.body.attachmentId) : null;
}

function findPart(
  part: GmailApiMessage["payload"],
  partId: string,
): NonNullable<GmailApiMessage["payload"]> | null {
  if (!part) return null;
  if (part.partId === partId) return part;
  for (const child of part.parts || []) {
    const found = findPart(child, partId);
    if (found) return found;
  }
  return null;
}

/** Which mailbox did these tokens just grant access to? Used when connecting. */
export async function fetchGmailProfile(
  tokens: GmailTokens,
  env: GmailEnv,
  fetchImpl: FetchImpl = fetch,
): Promise<{ emailAddress: string; historyId: string | null }> {
  const client = createClient({
    tokens,
    env,
    fetchImpl,
    nowMs: () => Date.now(),
    onTokens: async () => undefined,
  });
  const profile = await client.json<{ emailAddress?: string; historyId?: string }>("/profile");
  if (!profile.emailAddress) throw new GmailApiError("sync_failed", 0, "profile had no address");
  return { emailAddress: profile.emailAddress, historyId: profile.historyId ?? null };
}

export async function stopGmailWatch(tokens: GmailTokens, env: GmailEnv, fetchImpl: FetchImpl = fetch) {
  const client = createClient({
    tokens,
    env,
    fetchImpl,
    nowMs: () => Date.now(),
    onTokens: async () => undefined,
  });
  await client.json("/stop", { method: "POST" });
}
