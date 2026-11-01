import type {
  WebsiteRequest,
  WebsiteRequestStatus,
} from "./model";

export type WebsiteRequestPatch = {
  status?: WebsiteRequestStatus;
  quotedPriceCad?: number | null;
  scopeSummary?: string | null;
};

/**
 * Persistence for website-service requests. Reads that serve a customer are
 * always keyed by organization, so a request id from another business simply
 * does not exist as far as that customer is concerned.
 */
export type WebsiteRequestStore = {
  /**
   * Inserts the request. With an `idempotencyKey` a replay returns the
   * original (`created: false`) instead of adding a second row.
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
  listAll(filter?: {
    status?: WebsiteRequestStatus;
    limit?: number;
  }): Promise<WebsiteRequest[]>;
  /**
   * Applies the patch only while the request is still in `expectedStatus`
   * (compare-and-set), so two administrators cannot both win. Returns the new
   * row, or null when the request is gone or has moved on.
   */
  update(
    id: string,
    expectedStatus: WebsiteRequestStatus,
    patch: WebsiteRequestPatch,
    at: string,
  ): Promise<WebsiteRequest | null>;
};

const DEFAULT_LIMIT = 100;

export function createMemoryWebsiteRequestStore(): WebsiteRequestStore {
  const rows = new Map<string, WebsiteRequest>();
  const byKey = new Map<string, string>();

  const newestFirst = (a: WebsiteRequest, b: WebsiteRequest) =>
    b.createdAt.localeCompare(a.createdAt);

  return {
    async create(request, meta) {
      const key = meta?.idempotencyKey;
      if (key) {
        const existing = byKey.get(key);
        if (existing) return { created: false, request: rows.get(existing)! };
        byKey.set(key, request.id);
      }
      rows.set(request.id, request);
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
      return [...rows.values()]
        .filter((r) => !filter.status || r.status === filter.status)
        .sort(newestFirst)
        .slice(0, filter.limit ?? DEFAULT_LIMIT);
    },
    async update(id, expectedStatus, patch, at) {
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
        updatedAt: at,
      };
      if (patch.status && patch.status !== current.status) {
        next.status = patch.status;
        next.statusChangedAt = at;
      }
      rows.set(id, next);
      return next;
    },
  };
}
