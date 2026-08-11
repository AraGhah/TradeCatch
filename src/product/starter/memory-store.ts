import {
  createId,
  DEFAULT_QUOTE_STEPS_MS,
  type ConversationMode,
  type InboxItem,
  type InboxKind,
  type InboxStatus,
  type QuoteMessage,
  type QuoteStopReason,
  type QuoteThread,
  type QuoteThreadStatus,
  type WebsiteLead,
  type WebsiteLeadStatus,
} from "./types";

export type StarterStore = {
  // Website leads
  createWebsiteLead(
    lead: Omit<WebsiteLead, "id" | "createdAt" | "updatedAt" | "source"> & {
      id?: string;
    },
  ): Promise<WebsiteLead>;
  getWebsiteLead(
    id: string,
    organizationId: string,
  ): Promise<WebsiteLead | null>;
  listWebsiteLeads(organizationId: string): Promise<WebsiteLead[]>;
  updateWebsiteLead(
    id: string,
    organizationId: string,
    patch: Partial<
      Pick<
        WebsiteLead,
        | "status"
        | "conversationMode"
        | "openingSmsSent"
        | "name"
        | "message"
        | "serviceRequested"
        | "qualificationStepIndex"
        | "qualificationAnswers"
      >
    >,
  ): Promise<WebsiteLead | null>;

  // Quotes
  createQuoteThread(thread: QuoteThread): Promise<QuoteThread>;
  getQuoteThread(id: string, organizationId: string): Promise<QuoteThread | null>;
  listQuoteThreads(organizationId: string): Promise<QuoteThread[]>;
  findActiveQuoteByPhone(
    organizationId: string,
    phoneE164: string,
  ): Promise<QuoteThread | null>;
  updateQuoteThread(
    id: string,
    organizationId: string,
    patch: Partial<QuoteThread>,
  ): Promise<QuoteThread | null>;
  listDueQuoteThreads(nowIso: string, limit: number): Promise<QuoteThread[]>;
  addQuoteMessage(message: Omit<QuoteMessage, "id"> & { id?: string }): Promise<QuoteMessage>;
  listQuoteMessages(threadId: string): Promise<QuoteMessage[]>;

  // Inbox
  upsertInboxItem(
    item: Omit<InboxItem, "id" | "createdAt" | "updatedAt" | "status"> & {
      id?: string;
      status?: InboxStatus;
    },
  ): Promise<InboxItem>;
  listInbox(organizationId: string): Promise<InboxItem[]>;
  getInboxItem(id: string, organizationId: string): Promise<InboxItem | null>;
  updateInboxItem(
    id: string,
    organizationId: string,
    patch: Partial<Pick<InboxItem, "status" | "claimedByUserId" | "reason" | "title">>,
  ): Promise<InboxItem | null>;

  // Org API keys for website capture
  createOrgApiKey(input: {
    organizationId: string;
    tokenHash: string;
    label?: string;
  }): Promise<{ id: string }>;
  findOrgIdByApiKeyHash(tokenHash: string): Promise<string | null>;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(p: string) {
  return p.replace(/[^\d+]/g, "");
}

export function createMemoryStarterStore(): StarterStore {
  const website = new Map<string, WebsiteLead>();
  const quotes = new Map<string, QuoteThread>();
  const quoteMessages = new Map<string, QuoteMessage[]>();
  const inbox = new Map<string, InboxItem>();
  const apiKeys = new Map<string, { organizationId: string; revoked?: boolean }>();

  return {
    async createWebsiteLead(input) {
      const createdAt = nowIso();
      if (input.idempotencyKey) {
        for (const lead of website.values()) {
          if (
            lead.organizationId === input.organizationId &&
            lead.idempotencyKey === input.idempotencyKey
          ) {
            return lead;
          }
        }
      }
      const lead: WebsiteLead = {
        id: input.id ?? createId("wlead"),
        organizationId: input.organizationId,
        source: "website",
        name: input.name,
        email: input.email,
        phoneE164: input.phoneE164,
        message: input.message,
        serviceRequested: input.serviceRequested,
        sourceUrl: input.sourceUrl,
        status: input.status ?? "new",
        conversationMode: input.conversationMode ?? "auto",
        idempotencyKey: input.idempotencyKey,
        consentAt: input.consentAt,
        consentWording: input.consentWording,
        openingSmsSent: input.openingSmsSent ?? false,
        qualificationStepIndex: input.qualificationStepIndex,
        qualificationAnswers: input.qualificationAnswers,
        createdAt,
        updatedAt: createdAt,
      };
      website.set(lead.id, lead);
      return lead;
    },

    async getWebsiteLead(id, organizationId) {
      const lead = website.get(id);
      if (!lead || lead.organizationId !== organizationId) return null;
      return lead;
    },

    async listWebsiteLeads(organizationId) {
      return [...website.values()]
        .filter((l) => l.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async updateWebsiteLead(id, organizationId, patch) {
      const lead = website.get(id);
      if (!lead || lead.organizationId !== organizationId) return null;
      const next = { ...lead, ...patch, updatedAt: nowIso() };
      website.set(id, next);
      return next;
    },

    async createQuoteThread(thread) {
      quotes.set(thread.id, thread);
      return thread;
    },

    async getQuoteThread(id, organizationId) {
      const t = quotes.get(id);
      if (!t || t.organizationId !== organizationId) return null;
      return t;
    },

    async listQuoteThreads(organizationId) {
      return [...quotes.values()]
        .filter((t) => t.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async findActiveQuoteByPhone(organizationId, phoneE164) {
      const needle = normalizePhone(phoneE164);
      for (const t of quotes.values()) {
        if (
          t.organizationId === organizationId &&
          t.status === "active" &&
          normalizePhone(t.customerPhoneE164) === needle
        ) {
          return t;
        }
      }
      return null;
    },

    async updateQuoteThread(id, organizationId, patch) {
      const t = quotes.get(id);
      if (!t || t.organizationId !== organizationId) return null;
      const next = { ...t, ...patch, updatedAt: nowIso() };
      quotes.set(id, next);
      return next;
    },

    async listDueQuoteThreads(now, limit) {
      return [...quotes.values()]
        .filter(
          (t) =>
            t.status === "active" &&
            t.conversationMode === "auto" &&
            t.nextRunAt &&
            t.nextRunAt <= now,
        )
        .sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""))
        .slice(0, limit);
    },

    async addQuoteMessage(message) {
      const row: QuoteMessage = {
        id: message.id ?? createId("qmsg"),
        threadId: message.threadId,
        direction: message.direction,
        body: message.body,
        stepIndex: message.stepIndex,
        at: message.at,
      };
      const list = quoteMessages.get(row.threadId) ?? [];
      list.push(row);
      quoteMessages.set(row.threadId, list);
      return row;
    },

    async listQuoteMessages(threadId) {
      return [...(quoteMessages.get(threadId) ?? [])].sort((a, b) =>
        a.at.localeCompare(b.at),
      );
    },

    async upsertInboxItem(input) {
      for (const existing of inbox.values()) {
        if (
          existing.organizationId === input.organizationId &&
          existing.kind === input.kind &&
          existing.refId === input.refId
        ) {
          const next = {
            ...existing,
            title: input.title,
            reason: input.reason,
            status: input.status ?? existing.status,
            claimedByUserId: input.claimedByUserId ?? existing.claimedByUserId,
            updatedAt: nowIso(),
          };
          inbox.set(existing.id, next);
          return next;
        }
      }
      const createdAt = nowIso();
      const item: InboxItem = {
        id: input.id ?? createId("inbox"),
        organizationId: input.organizationId,
        kind: input.kind,
        refId: input.refId,
        title: input.title,
        reason: input.reason,
        status: input.status ?? "open",
        claimedByUserId: input.claimedByUserId,
        createdAt,
        updatedAt: createdAt,
      };
      inbox.set(item.id, item);
      return item;
    },

    async listInbox(organizationId) {
      return [...inbox.values()]
        .filter((i) => i.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async getInboxItem(id, organizationId) {
      const item = inbox.get(id);
      if (!item || item.organizationId !== organizationId) return null;
      return item;
    },

    async updateInboxItem(id, organizationId, patch) {
      const item = inbox.get(id);
      if (!item || item.organizationId !== organizationId) return null;
      const next = { ...item, ...patch, updatedAt: nowIso() };
      inbox.set(id, next);
      return next;
    },

    async createOrgApiKey(input) {
      const id = createId("oak");
      apiKeys.set(input.tokenHash, { organizationId: input.organizationId });
      return { id };
    },

    async findOrgIdByApiKeyHash(tokenHash) {
      const row = apiKeys.get(tokenHash);
      if (!row || row.revoked) return null;
      return row.organizationId;
    },
  };
}

export function buildQuoteThread(input: {
  organizationId: string;
  clientAccountId?: string;
  customerPhoneE164: string;
  customerName?: string;
  quoteRef?: string;
  quoteAmount?: number;
  quoteSentAt?: string;
  locale?: "en" | "fr";
}): QuoteThread {
  const createdAt = nowIso();
  const quoteSentAt = input.quoteSentAt ?? createdAt;
  const firstDelay = DEFAULT_QUOTE_STEPS_MS[0]!;
  return {
    id: createId("qth"),
    organizationId: input.organizationId,
    clientAccountId: input.clientAccountId,
    customerPhoneE164: input.customerPhoneE164,
    customerName: input.customerName,
    quoteRef: input.quoteRef,
    quoteAmount: input.quoteAmount,
    quoteSentAt,
    locale: input.locale ?? "en",
    status: "active",
    conversationMode: "auto",
    nextStepIndex: 0,
    nextRunAt: new Date(Date.parse(quoteSentAt) + firstDelay).toISOString(),
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

export type {
  ConversationMode,
  InboxItem,
  InboxKind,
  InboxStatus,
  QuoteMessage,
  QuoteStopReason,
  QuoteThread,
  QuoteThreadStatus,
  WebsiteLead,
  WebsiteLeadStatus,
};
