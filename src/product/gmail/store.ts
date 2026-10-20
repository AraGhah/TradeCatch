import { createId } from "@/lib/id";
import type { NotificationStore } from "@/product/notifications/store";
import { gmailReplyEvent } from "./notifications";
import type { GmailAccount, GmailMessage, GmailMessageSummary } from "./types";

export type MessageFilter = {
  q?: string;
  unread?: boolean;
  important?: boolean;
  attachments?: boolean;
  limit?: number;
  /** Keyset cursor: return rows strictly older than this (receivedAt, id). */
  before?: { receivedAt: string; id: string };
};

export const DEFAULT_PAGE = 30;
export const MAX_PAGE = 100;

export function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_PAGE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
}

/** Fields a sync is allowed to change on an existing account. */
export type GmailAccountPatch = Partial<
  Pick<
    GmailAccount,
    | "email"
    | "status"
    | "tokenCiphertext"
    | "historyId"
    | "watchExpiration"
    | "lastSyncAt"
    | "lastAttemptAt"
    | "nextSyncAt"
    | "failureCount"
    | "lastError"
  >
>;

export type NewGmailMessage = Omit<GmailMessage, "id" | "createdAt"> & {
  id?: string;
};

export type GmailStore = {
  getAccount(
    organizationId: string,
    userId: string,
  ): Promise<GmailAccount | null>;
  findAccountsByEmail(email: string): Promise<GmailAccount[]>;
  /** Connected accounts that have not been tried recently and are not backing off. */
  listAccountsDue(input: {
    nowIso: string;
    staleBeforeIso: string;
    limit: number;
  }): Promise<GmailAccount[]>;
  /** Insert or replace the row for (organization, user). Used only when connecting. */
  saveAccount(row: GmailAccount): Promise<void>;
  /** Partial update that never re-creates an account removed in the meantime. */
  updateAccount(id: string, patch: GmailAccountPatch): Promise<boolean>;
  /** Deleting an account also deletes its stored messages. */
  deleteAccount(organizationId: string, userId: string): Promise<void>;
  clearMessages(accountId: string): Promise<void>;
  /** Single-flight guard for syncing one account across tabs, cron and push. */
  tryBeginSync(accountId: string, now: Date, leaseMs: number): Promise<boolean>;
  endSync(accountId: string): Promise<void>;

  upsertMessage(
    row: NewGmailMessage,
    queueReplyAlert?: boolean,
  ): Promise<{ message: GmailMessage; inserted: boolean }>;
  existingGmailIds(accountId: string, gmailIds: string[]): Promise<Set<string>>;
  threadKnown(accountId: string, threadId: string): Promise<boolean>;
  setUnreadByGmailId(
    accountId: string,
    gmailId: string,
    unread: boolean,
  ): Promise<void>;
  deleteByGmailIds(accountId: string, gmailIds: string[]): Promise<void>;

  listMessages(
    organizationId: string,
    userId: string,
    filter?: MessageFilter,
  ): Promise<GmailMessageSummary[]>;
  getMessage(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<GmailMessage | null>;
  listThread(
    organizationId: string,
    userId: string,
    threadId: string,
  ): Promise<GmailMessage[]>;
  countUnread(organizationId: string, userId: string): Promise<number>;
  setRead(
    organizationId: string,
    userId: string,
    id: string,
    read: boolean,
  ): Promise<boolean>;
};

export function toSummary(message: GmailMessage): GmailMessageSummary {
  return {
    id: message.id,
    threadId: message.threadId,
    fromName: message.fromName,
    fromEmail: message.fromEmail,
    subject: message.subject,
    snippet: message.snippet,
    receivedAt: message.receivedAt,
    unread: message.unread,
    hasAttachments: message.hasAttachments,
    important: message.important,
    direction: message.direction,
  };
}

function matches(message: GmailMessage, filter?: MessageFilter): boolean {
  if (message.direction !== "inbound") return false;
  if (filter?.unread && !message.unread) return false;
  if (filter?.important && !message.important) return false;
  if (filter?.attachments && !message.hasAttachments) return false;
  const q = filter?.q?.trim().toLowerCase();
  if (!q) return true;
  return `${message.fromName || ""} ${message.fromEmail} ${message.subject} ${message.snippet} ${message.bodyText || ""}`
    .toLowerCase()
    .includes(q);
}

function newerFirst(a: GmailMessage, b: GmailMessage): number {
  const diff = Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
  return diff !== 0 ? diff : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export function createMemoryGmailStore(
  notifications?: NotificationStore,
): GmailStore {
  const accounts = new Map<string, GmailAccount>();
  const leases = new Map<string, number>();
  const messages = new Map<string, GmailMessage>();

  const byOwner = (organizationId: string, userId: string) =>
    [...accounts.values()].find(
      (row) => row.organizationId === organizationId && row.userId === userId,
    ) ?? null;
  const owned =
    (organizationId: string, userId: string) => (message: GmailMessage) =>
      message.organizationId === organizationId && message.userId === userId;

  function removeMessages(accountId: string) {
    for (const [id, message] of messages) {
      if (message.accountId === accountId) messages.delete(id);
    }
  }

  return {
    async getAccount(organizationId, userId) {
      return byOwner(organizationId, userId);
    },
    async findAccountsByEmail(email) {
      const wanted = email.trim().toLowerCase();
      return [...accounts.values()].filter(
        (row) =>
          row.email?.toLowerCase() === wanted && row.status === "connected",
      );
    },
    async listAccountsDue({ nowIso, staleBeforeIso, limit }) {
      const now = Date.parse(nowIso);
      const stale = Date.parse(staleBeforeIso);
      return [...accounts.values()]
        .filter((row) => row.status === "connected" && row.tokenCiphertext)
        .filter((row) => !row.nextSyncAt || Date.parse(row.nextSyncAt) <= now)
        .filter(
          (row) => !row.lastAttemptAt || Date.parse(row.lastAttemptAt) <= stale,
        )
        .filter((row) => (leases.get(row.id) ?? 0) <= now)
        .sort(
          (a, b) =>
            Date.parse(a.lastAttemptAt || "0") -
            Date.parse(b.lastAttemptAt || "0"),
        )
        .slice(0, limit);
    },
    async saveAccount(row) {
      const existing = byOwner(row.organizationId, row.userId);
      if (existing && existing.id !== row.id) accounts.delete(existing.id);
      accounts.set(row.id, row);
    },
    async updateAccount(id, patch) {
      const existing = accounts.get(id);
      if (!existing) return false;
      accounts.set(id, {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      return true;
    },
    async deleteAccount(organizationId, userId) {
      const account = byOwner(organizationId, userId);
      if (!account) return;
      accounts.delete(account.id);
      leases.delete(account.id);
      removeMessages(account.id);
    },
    async clearMessages(accountId) {
      removeMessages(accountId);
    },
    async tryBeginSync(accountId, now, leaseMs) {
      if (!accounts.has(accountId)) return false;
      if ((leases.get(accountId) ?? 0) > now.getTime()) return false;
      leases.set(accountId, now.getTime() + leaseMs);
      return true;
    },
    async endSync(accountId) {
      leases.delete(accountId);
    },

    async upsertMessage(row, queueReplyAlert) {
      // Mirrors the foreign key in Postgres: no mail for an account that was disconnected mid-sync.
      if (!accounts.has(row.accountId))
        throw new Error("gmail account no longer exists");
      const existing = [...messages.values()].find(
        (message) =>
          message.accountId === row.accountId &&
          message.gmailId === row.gmailId,
      );
      if (existing) {
        // Read state is deliberately kept: the user may have read it here already.
        const next: GmailMessage = {
          ...existing,
          subject: row.subject,
          snippet: row.snippet,
          bodyText: row.bodyText ?? existing.bodyText,
          hasAttachments: row.hasAttachments,
          attachments: row.attachments,
        };
        messages.set(existing.id, next);
        return { message: next, inserted: false };
      }
      const message: GmailMessage = {
        ...row,
        id: row.id || createId("gml"),
        createdAt: new Date().toISOString(),
      };
      if (queueReplyAlert && notifications)
        await notifications.insertOutbox(gmailReplyEvent(message));
      messages.set(message.id, message);
      return { message, inserted: true };
    },
    async existingGmailIds(accountId, gmailIds) {
      const wanted = new Set(gmailIds);
      const found = new Set<string>();
      for (const message of messages.values()) {
        if (message.accountId === accountId && wanted.has(message.gmailId))
          found.add(message.gmailId);
      }
      return found;
    },
    async threadKnown(accountId, threadId) {
      return [...messages.values()].some(
        (message) =>
          message.accountId === accountId && message.threadId === threadId,
      );
    },
    async setUnreadByGmailId(accountId, gmailId, unread) {
      for (const [id, message] of messages) {
        if (
          message.accountId === accountId &&
          message.gmailId === gmailId &&
          message.direction === "inbound"
        ) {
          messages.set(id, { ...message, unread });
        }
      }
    },
    async deleteByGmailIds(accountId, gmailIds) {
      const wanted = new Set(gmailIds);
      for (const [id, message] of messages) {
        if (message.accountId === accountId && wanted.has(message.gmailId))
          messages.delete(id);
      }
    },

    async listMessages(organizationId, userId, filter) {
      const before = filter?.before;
      const rows = [...messages.values()]
        .filter(owned(organizationId, userId))
        .filter((message) => matches(message, filter))
        .sort(newerFirst)
        .filter((message) => {
          if (!before) return true;
          const at = Date.parse(message.receivedAt);
          const cut = Date.parse(before.receivedAt);
          return at < cut || (at === cut && message.id < before.id);
        });
      return rows.slice(0, clampLimit(filter?.limit)).map(toSummary);
    },
    async getMessage(organizationId, userId, id) {
      const message = messages.get(id);
      if (!message || !owned(organizationId, userId)(message)) return null;
      return message;
    },
    async listThread(organizationId, userId, threadId) {
      return [...messages.values()]
        .filter(owned(organizationId, userId))
        .filter((message) => message.threadId === threadId)
        .sort((a, b) => -newerFirst(a, b));
    },
    async countUnread(organizationId, userId) {
      return [...messages.values()].filter(
        (message) =>
          owned(organizationId, userId)(message) &&
          message.direction === "inbound" &&
          message.unread,
      ).length;
    },
    async setRead(organizationId, userId, id, read) {
      const message = messages.get(id);
      if (
        !message ||
        !owned(organizationId, userId)(message) ||
        message.direction !== "inbound"
      )
        return false;
      messages.set(id, { ...message, unread: !read });
      return true;
    },
  };
}
