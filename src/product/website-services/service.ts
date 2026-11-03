import { createId } from "@/lib/id";
import {
  normalizeWebsiteUrl,
  type WebsiteRequestInput,
  type WebsiteRequestUpdate,
} from "@/lib/validation/website-request";
import { ADD_ONS } from "@/product/saas/plan-catalog";
import {
  TERMINAL_WEBSITE_STATUSES,
  canTransitionWebsiteStatus,
  isValidQuotedPrice,
  type WebsiteRequest,
  type WebsiteRequestSource,
  type WebsiteRequestStatus,
} from "./model";
import type { WebsiteRequestPatch, WebsiteRequestStore } from "./store";

export type WebsiteRequestUpdateError =
  | "not_found"
  | "invalid_transition"
  | "locked"
  | "price_too_low"
  | "quote_required"
  | "conflict";

export type WebsiteRequestService = {
  /**
   * Records a request. It adds nothing to a subscription and starts no billing:
   * the only effect is a row the team will answer with a written scope and
   * price.
   */
  submit(
    input: WebsiteRequestInput,
    context: {
      organizationId: string | null;
      source: WebsiteRequestSource;
      idempotencyKey?: string;
      createdByUserId?: string;
    },
  ): Promise<{ created: boolean; request: WebsiteRequest }>;
  listForOrganization(organizationId: string): Promise<WebsiteRequest[]>;
  listAll(filter?: {
    status?: WebsiteRequestStatus;
    limit?: number;
  }): Promise<WebsiteRequest[]>;
  /** A customer sees only their own business's requests. */
  getForOrganization(
    id: string,
    organizationId: string,
  ): Promise<WebsiteRequest | null>;
  adminUpdate(
    id: string,
    update: WebsiteRequestUpdate,
  ): Promise<
    | { ok: true; request: WebsiteRequest }
    | { ok: false; error: WebsiteRequestUpdateError }
  >;
};

export function createWebsiteRequestService(
  store: WebsiteRequestStore,
  now: () => Date = () => new Date(),
): WebsiteRequestService {
  const startingPrice = ADD_ONS.websiteService.priceCad;

  return {
    async submit(input, context) {
      const at = now().toISOString();
      const url = input.currentWebsiteUrl?.trim()
        ? normalizeWebsiteUrl(input.currentWebsiteUrl)
        : null;
      const request: WebsiteRequest = {
        id: createId("wsr"),
        organizationId: context.organizationId,
        requestType: input.requestType,
        status: "submitted",
        source: context.source,
        businessName: input.businessName.trim(),
        contactName: input.contactName.trim(),
        contactEmail: input.contactEmail.trim().toLowerCase(),
        contactPhone: input.contactPhone?.trim() || null,
        currentWebsiteUrl: url,
        // De-duplicated, in the order the form lists them.
        focusAreas: [...new Set(input.focusAreas)],
        notes: input.notes?.trim() || null,
        language: input.language,
        quotedPriceCad: null,
        scopeSummary: null,
        createdAt: at,
        updatedAt: at,
        statusChangedAt: at,
      };
      return store.create(request, {
        idempotencyKey: context.idempotencyKey,
        createdByUserId: context.createdByUserId,
      });
    },

    listForOrganization: (organizationId) =>
      store.listForOrganization(organizationId),

    listAll: (filter) => store.listAll(filter),

    async getForOrganization(id, organizationId) {
      const found = await store.get(id);
      // The organization check is the tenant boundary: another business's id
      // is indistinguishable from one that does not exist.
      return found && found.organizationId === organizationId ? found : null;
    },

    async adminUpdate(id, update) {
      const current = await store.get(id);
      if (!current) return { ok: false, error: "not_found" };

      if (TERMINAL_WEBSITE_STATUSES.includes(current.status)) {
        return { ok: false, error: "invalid_transition" };
      }
      const nextStatus = update.status ?? current.status;
      if (!canTransitionWebsiteStatus(current.status, nextStatus)) {
        return { ok: false, error: "invalid_transition" };
      }

      const price =
        update.quotedPriceCad !== undefined
          ? update.quotedPriceCad
          : current.quotedPriceCad;
      const scope =
        update.scopeSummary !== undefined
          ? update.scopeSummary?.trim() || null
          : current.scopeSummary;
      const quoteChanged =
        price !== current.quotedPriceCad || scope !== current.scopeSummary;

      // Once the customer has agreed and work started, the agreed scope and
      // price are not edited behind their back.
      if (current.status === "in_progress" && quoteChanged) {
        return { ok: false, error: "locked" };
      }
      if (price !== null && !isValidQuotedPrice(price, startingPrice)) {
        return { ok: false, error: "price_too_low" };
      }
      // Nothing moves to "quoted" or beyond without the written scope and the
      // final price the customer will be asked to confirm.
      const needsQuote =
        nextStatus === "quoted" ||
        nextStatus === "in_progress" ||
        nextStatus === "delivered";
      if (needsQuote && (price === null || !scope)) {
        return { ok: false, error: "quote_required" };
      }

      const patch: WebsiteRequestPatch = {};
      if (nextStatus !== current.status) patch.status = nextStatus;
      if (update.quotedPriceCad !== undefined) patch.quotedPriceCad = price;
      if (update.scopeSummary !== undefined) patch.scopeSummary = scope;

      const updated = await store.update(
        id,
        current.status,
        patch,
        now().toISOString(),
      );
      return updated
        ? { ok: true, request: updated }
        : { ok: false, error: "conflict" };
    },
  };
}
