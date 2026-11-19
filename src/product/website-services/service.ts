import { createId } from "@/lib/id";
import {
  normalizeWebsiteUrl,
  type WebsiteRequestInput,
  type WebsiteRequestUpdate,
} from "@/lib/validation/website-request";
import { ADD_ONS } from "@/product/saas/plan-catalog";
import {
  PAYMENT_REQUEST_STATUSES,
  TERMINAL_WEBSITE_STATUSES,
  canTransitionWebsitePayment,
  canTransitionWebsiteStatus,
  isValidQuotedPrice,
  type WebsiteNotificationStatus,
  type WebsitePaymentStatus,
  type WebsiteRequest,
  type WebsiteRequestEvent,
  type WebsiteRequestSource,
  type WebsiteRequestStatus,
} from "./model";
import type {
  WebsiteRequestHistoryEntry,
  WebsiteRequestListFilter,
  WebsiteRequestPatch,
  WebsiteRequestStore,
} from "./store";

export type WebsiteRequestUpdateError =
  | "not_found"
  | "invalid_transition"
  | "invalid_payment_transition"
  | "payment_not_allowed"
  | "review_note_required"
  | "locked"
  | "price_mismatch"
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
  listAll(filter?: WebsiteRequestListFilter): Promise<WebsiteRequest[]>;
  countAll(filter?: WebsiteRequestListFilter): Promise<number>;
  /** A customer sees only their own business's requests. */
  getForOrganization(
    id: string,
    organizationId: string,
  ): Promise<WebsiteRequest | null>;
  /** For administrators: any request, by id. */
  getAny(id: string): Promise<WebsiteRequest | null>;
  /** The request's history, oldest first. For administrators. */
  history(id: string): Promise<WebsiteRequestEvent[]>;
  recordNotification(
    id: string,
    status: WebsiteNotificationStatus,
  ): Promise<void>;
  /**
   * `actor` is recorded in the request's history: an administrator's email, or
   * "ops:<name>". It is never shown to the customer.
   */
  adminUpdate(
    id: string,
    update: WebsiteRequestUpdate,
    actor?: string,
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
  const priceIsStartingAt: boolean = ADD_ONS.websiteService.priceIsStartingAt;

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
        paymentStatus: "not_requested",
        reviewNote: null,
        notificationStatus: null,
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

    countAll: (filter) => store.countAll(filter),

    async getForOrganization(id, organizationId) {
      const found = await store.get(id);
      // The organization check is the tenant boundary: another business's id
      // is indistinguishable from one that does not exist.
      return found && found.organizationId === organizationId ? found : null;
    },

    getAny: (id) => store.get(id),

    history: (id) => store.listEvents(id),

    recordNotification: (id, status) =>
      store.recordNotification(id, status, now().toISOString()),

    async adminUpdate(id, update, actor = "admin") {
      const current = await store.get(id);
      if (!current) return { ok: false, error: "not_found" };

      if (TERMINAL_WEBSITE_STATUSES.includes(current.status)) {
        return { ok: false, error: "invalid_transition" };
      }
      const nextStatus = update.status ?? current.status;
      if (!canTransitionWebsiteStatus(current.status, nextStatus)) {
        return { ok: false, error: "invalid_transition" };
      }

      let price =
        update.quotedPriceCad !== undefined
          ? update.quotedPriceCad
          : current.quotedPriceCad;
      // A fixed-price service never needs a hand-typed price: quoting it uses
      // the published one, so the customer is always told what the site says.
      const advancing =
        nextStatus === "quoted" ||
        nextStatus === "in_progress" ||
        nextStatus === "delivered";
      if (!priceIsStartingAt && price === null && advancing) {
        price = startingPrice;
        update = { ...update, quotedPriceCad: price };
      }
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
      if (price !== null && !isValidQuotedPrice(price, startingPrice, priceIsStartingAt)) {
        return { ok: false, error: priceIsStartingAt ? "price_too_low" : "price_mismatch" };
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

      const note =
        update.reviewNote !== undefined
          ? update.reviewNote?.trim() || null
          : current.reviewNote;
      // A rejection always says why, so the next person reading the history
      // (and any later conversation with the customer) has the reason.
      if (nextStatus === "rejected" && !note) {
        return { ok: false, error: "review_note_required" };
      }

      // Payment is recorded here, never collected here: nothing on this path
      // can create a charge. Asking for payment needs approved work and a price.
      let payment: WebsitePaymentStatus =
        update.paymentStatus ?? current.paymentStatus;
      if (
        update.paymentStatus !== undefined &&
        !canTransitionWebsitePayment(current.paymentStatus, update.paymentStatus)
      ) {
        return { ok: false, error: "invalid_payment_transition" };
      }
      if (payment === "requested" && current.paymentStatus !== "requested") {
        if (!PAYMENT_REQUEST_STATUSES.includes(nextStatus)) {
          return { ok: false, error: "payment_not_allowed" };
        }
        if (price === null) return { ok: false, error: "quote_required" };
      }
      // A request that will never be built has nothing left to pay for.
      if (
        (nextStatus === "rejected" || nextStatus === "cancelled") &&
        payment === "requested"
      ) {
        payment = "not_requested";
      }

      const patch: WebsiteRequestPatch = {};
      if (nextStatus !== current.status) patch.status = nextStatus;
      if (update.quotedPriceCad !== undefined) patch.quotedPriceCad = price;
      if (update.scopeSummary !== undefined) patch.scopeSummary = scope;
      if (payment !== current.paymentStatus) patch.paymentStatus = payment;
      if (update.reviewNote !== undefined) patch.reviewNote = note;

      const history: WebsiteRequestHistoryEntry[] = [];
      if (patch.status) {
        history.push({
          kind: "status_changed",
          actor,
          note: nextStatus === "rejected" ? note : null,
        });
      }
      if (quoteChanged) {
        history.push({
          kind: "quote_updated",
          actor,
          note: price === null ? "price cleared" : `CAD ${price.toFixed(2)}`,
        });
      }
      if (patch.paymentStatus) {
        history.push({ kind: "payment_updated", actor, note: payment });
      }
      if (patch.reviewNote !== undefined && !patch.status) {
        history.push({ kind: "note", actor, note: note?.slice(0, 200) ?? null });
      }

      const updated = await store.update(
        id,
        current.status,
        patch,
        now().toISOString(),
        history,
      );
      return updated
        ? { ok: true, request: updated }
        : { ok: false, error: "conflict" };
    },
  };
}

export type { WebsiteRequestStatus };
