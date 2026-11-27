import { createId } from "@/lib/id";
import type {
  WebsiteNotificationStatus,
  WebsitePaymentStatus,
  WebsiteRequest,
  WebsiteRequestEvent,
  WebsiteRequestStatus,
} from "./model";

export type WebsiteRequestPatch = {
  status?: WebsiteRequestStatus;
  quotedPriceCad?: number | null;
  scopeSummary?: string | null;
  paymentStatus?: WebsitePaymentStatus;
  reviewNote?: string | null;
};

/** What to append to the request's history together with the change itself. */
export type WebsiteRequestHistoryEntry = Pick<
  WebsiteRequestEvent,
  "kind" | "actor" | "note"
>;

export type WebsiteRequestListFilter = {
  status?: WebsiteRequestStatus;
  limit?: number;
  offset?: number;
  /** Matches business, contact name or contact email, case-insensitively. */
  q?: string;
  paymentStatus?: WebsitePaymentStatus;
  organizationId?: string;
  /** Inclusive YYYY-MM-DD bounds on the submission date. */
  from?: string;
  to?: string;
};

/**
 * Persistence for website-service requests. Reads that serve a customer are
 * always keyed by organization, so a request id from another business simply
 * does not exist as far as that customer is concerned.
 */
export type WebsiteRequestStore = {
  /**
   * Inserts the request and its first history line. With an `idempotencyKey` a
   * replay returns the original (`created: false`) instead of adding a second
   * row.
   */
  create(
    request: WebsiteRequest,
    meta?: { idempotencyKey?: string; createdByUserId?: string },
  ): Promise<{ created: boolean; request: WebsiteRequest }>;
  get(id: string): Promise<WebsiteRequest | null>;
  listForOrganization(
    organizationId: string,
    limit?: number,
  ): Promise<WebsiteRequest[]>;
  listAll(filter?: WebsiteRequestListFilter): Promise<WebsiteRequest[]>;
  /** The same filter, ignoring limit and offset. */
  countAll(filter?: WebsiteRequestListFilter): Promise<number>;
  /**
   * Applies the patch only while the request is still in `expectedStatus`
   * (compare-and-set), so two administrators cannot both win. The history line
   * is written in the same step. Returns the new row, or null when the request
   * is gone or has moved on.
   */
  update(
    id: string,
    expectedStatus: WebsiteRequestStatus,
    patch: WebsiteRequestPatch,
    at: string,
    history?: WebsiteRequestHistoryEntry[],
  ): Promise<WebsiteRequest | null>;
  /** Records whether the team notification went out, and says so in the history. */
  recordNotification(
    id: string,
    status: WebsiteNotificationStatus,
    at: string,
  ): Promise<void>;
  /**
   * Records an email to the customer in the history ("notified", with the
   * note saying which one and whether it went out). Leaves the team
   * notification status alone.
   */
  recordCustomerNotification(id: string, note: string, at: string): Promise<void>;
  /** Oldest first. */
  listEvents(requestId: string): Promise<WebsiteRequestEvent[]>;
};

const DEFAULT_LIMIT = 100;

export function createMemoryWebsiteRequestStore(): WebsiteRequestStore {
  const rows = new Map<string, WebsiteRequest>();
  const byKey = new Map<string, string>();
  const events: WebsiteRequestEvent[] = [];

  const newestFirst = (a: WebsiteRequest, b: WebsiteRequest) =>
    b.createdAt.localeCompare(a.createdAt);

  const matches = (r: WebsiteRequest, filter: WebsiteRequestListFilter) => {
    if (filter.status && r.status !== filter.status) return false;
    if (filter.paymentStatus && r.paymentStatus !== filter.paymentStatus) {
      return false;
    }
    if (filter.organizationId && r.organizationId !== filter.organizationId) {
      return false;
    }
    if (filter.from && r.createdAt.slice(0, 10) < filter.from) return false;
    if (filter.to && r.createdAt.slice(0, 10) > filter.to) return false;
    const q = filter.q?.trim().toLowerCase();
    if (
      q &&
      ![r.businessName, r.contactName, r.contactEmail]
        .join(" ")
        .toLowerCase()
        .includes(q)
    ) {
      return false;
    }
    return true;
  };

  const push = (
    requestId: string,
    entry: Partial<WebsiteRequestEvent> & Pick<WebsiteRequestEvent, "kind">,
    at: string,
  ) => {
    events.push({
      id: createId("wse"),
      requestId,
      actor: null,
      fromStatus: null,
      toStatus: null,
      fromPayment: null,
      toPayment: null,
      note: null,
      createdAt: at,
      ...entry,
    });
  };

  return {
    async create(request, meta) {
      const key = meta?.idempotencyKey;
      if (key) {
        const existing = byKey.get(key);
        if (existing) return { created: false, request: rows.get(existing)! };
        byKey.set(key, request.id);
      }
      rows.set(request.id, request);
      push(
        request.id,
        {
          kind: "submitted",
          actor: "customer",
          toStatus: request.status,
          toPayment: request.paymentStatus,
        },
        request.createdAt,
      );
      return { created: true, request };
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async listForOrganization(organizationId, limit = DEFAULT_LIMIT) {
      return [...rows.values()]
        .filter((r) => r.organizationId === organizationId)
        .sort(newestFirst)
        .slice(0, limit);
    },
    async listAll(filter = {}) {
      const offset = Math.max(0, filter.offset ?? 0);
      return [...rows.values()]
        .filter((r) => matches(r, filter))
        .sort(newestFirst)
        .slice(offset, offset + (filter.limit ?? DEFAULT_LIMIT));
    },
    async countAll(filter = {}) {
      return [...rows.values()].filter((r) => matches(r, filter)).length;
    },
    async update(id, expectedStatus, patch, at, history = []) {
      const current = rows.get(id);
      if (!current || current.status !== expectedStatus) return null;
      const next: WebsiteRequest = {
        ...current,
        ...(patch.quotedPriceCad !== undefined
          ? { quotedPriceCad: patch.quotedPriceCad }
          : {}),
        ...(patch.scopeSummary !== undefined
          ? { scopeSummary: patch.scopeSummary }
          : {}),
        ...(patch.paymentStatus !== undefined
          ? { paymentStatus: patch.paymentStatus }
          : {}),
        ...(patch.reviewNote !== undefined
          ? { reviewNote: patch.reviewNote }
          : {}),
        updatedAt: at,
      };
      if (patch.status && patch.status !== current.status) {
        next.status = patch.status;
        next.statusChangedAt = at;
      }
      rows.set(id, next);
      for (const entry of history) {
        push(
          id,
          {
            ...entry,
            fromStatus: current.status,
            toStatus: next.status,
            fromPayment: current.paymentStatus,
            toPayment: next.paymentStatus,
          },
          at,
        );
      }
      return next;
    },
    async recordNotification(id, status, at) {
      const current = rows.get(id);
      if (!current) return;
      rows.set(id, { ...current, notificationStatus: status });
      push(id, { kind: "notified", note: status }, at);
    },
    async recordCustomerNotification(id, note, at) {
      if (!rows.has(id)) return;
      push(id, { kind: "notified", note }, at);
    },
    async listEvents(requestId) {
      return events
        .filter((e) => e.requestId === requestId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}
