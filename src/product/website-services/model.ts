/**
 * Done-for-You Website Service: the request a customer (or a visitor) sends,
 * and where it is in our process.
 *
 * This is a one-time project that sits OUTSIDE the subscription. A request
 * never adds a charge, a Stripe price or a plan change; the final scope and
 * price are confirmed with the customer before anything is paid. Pure types
 * and constants: safe to import from client components.
 */

export const WEBSITE_REQUEST_TYPES = ["new", "improve"] as const;
export type WebsiteRequestType = (typeof WEBSITE_REQUEST_TYPES)[number];

/** What the customer wants worked on. Optional, multi-select. */
export const WEBSITE_FOCUS_AREAS = [
  "mobile",
  "contact_form",
  "lead_capture",
  "tradecatch",
  "design",
  "content",
] as const;
export type WebsiteFocusArea = (typeof WEBSITE_FOCUS_AREAS)[number];

/** Where the request was made. Tells the team what the customer already knows. */
export const WEBSITE_REQUEST_SOURCES = [
  "pricing",
  "onboarding",
  "dashboard",
] as const;
export type WebsiteRequestSource = (typeof WEBSITE_REQUEST_SOURCES)[number];

/**
 * The life of a request, in order. `quoted` means the team has written back
 * with the scope and final price and is waiting for the customer's go-ahead;
 * nothing is charged before that.
 */
export const WEBSITE_REQUEST_STATUSES = [
  "submitted",
  "in_review",
  "approved",
  "quoted",
  "in_progress",
  "delivered",
  "rejected",
  "cancelled",
] as const;
export type WebsiteRequestStatus = (typeof WEBSITE_REQUEST_STATUSES)[number];

/** Statuses a request can no longer leave. */
export const TERMINAL_WEBSITE_STATUSES: readonly WebsiteRequestStatus[] = [
  "delivered",
  "rejected",
  "cancelled",
];

/**
 * The names the administration console shows. The five the team works with
 * (Pending, Under Review, Approved, Rejected, Completed) map one-to-one onto
 * submitted, in_review, approved, rejected and delivered; quoted and
 * in_progress are the existing steps between approval and delivery, and
 * cancelled is the customer (or team) withdrawing an open request.
 */
export const WEBSITE_STATUS_LABELS: Record<WebsiteRequestStatus, string> = {
  submitted: "Pending",
  in_review: "Under review",
  approved: "Approved",
  quoted: "Quote sent",
  in_progress: "In progress",
  delivered: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/**
 * Where payment stands. Nothing here charges anyone: it records what the team
 * has asked the customer for and whether they have confirmed receiving it.
 * Money is only ever collected through a Stripe flow the customer completes.
 */
export const WEBSITE_PAYMENT_STATUSES = [
  "not_requested",
  "requested",
  "paid",
  "waived",
] as const;
export type WebsitePaymentStatus = (typeof WEBSITE_PAYMENT_STATUSES)[number];

/** Whether the team was told about the request. */
export const WEBSITE_NOTIFICATION_STATUSES = [
  "sent",
  "not_configured",
  "failed",
] as const;
export type WebsiteNotificationStatus =
  (typeof WEBSITE_NOTIFICATION_STATUSES)[number];

const PAYMENT_TRANSITIONS: Record<
  WebsitePaymentStatus,
  readonly WebsitePaymentStatus[]
> = {
  not_requested: ["requested", "waived"],
  requested: ["not_requested", "paid", "waived"],
  paid: [],
  waived: [],
};

export function canTransitionWebsitePayment(
  from: WebsitePaymentStatus,
  to: WebsitePaymentStatus,
): boolean {
  return from === to || PAYMENT_TRANSITIONS[from].includes(to);
}

/** A payment can only be asked for once the team has approved or quoted the work. */
export const PAYMENT_REQUEST_STATUSES: readonly WebsiteRequestStatus[] = [
  "approved",
  "quoted",
  "in_progress",
];

export type WebsiteRequest = {
  id: string;
  /** Null for a visitor who is not signed in; set when a customer asks. */
  organizationId: string | null;
  requestType: WebsiteRequestType;
  status: WebsiteRequestStatus;
  source: WebsiteRequestSource;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  currentWebsiteUrl: string | null;
  focusAreas: WebsiteFocusArea[];
  notes: string | null;
  language: "en" | "fr";
  /** Set when the scope is agreed. At launch always the fixed website service price. */
  quotedPriceCad: number | null;
  /** The scope the team wrote back, shown to the customer. */
  scopeSummary: string | null;
  /** Internal to the team, never shown to the customer. */
  paymentStatus: WebsitePaymentStatus;
  /** Why the team rejected it, or any other internal note. Never shown to the customer. */
  reviewNote: string | null;
  /** Whether the team notification went out when the request arrived. */
  notificationStatus: WebsiteNotificationStatus | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
};

/**
 * What the dashboard shows the customer. The team's internal notes and the
 * submitting user's identity are not part of this.
 */
export type WebsiteRequestView = Pick<
  WebsiteRequest,
  | "id"
  | "requestType"
  | "status"
  | "source"
  | "businessName"
  | "currentWebsiteUrl"
  | "focusAreas"
  | "notes"
  | "quotedPriceCad"
  | "scopeSummary"
  | "createdAt"
  | "updatedAt"
  | "statusChangedAt"
>;

export function toWebsiteRequestView(request: WebsiteRequest): WebsiteRequestView {
  return {
    id: request.id,
    requestType: request.requestType,
    status: request.status,
    source: request.source,
    businessName: request.businessName,
    currentWebsiteUrl: request.currentWebsiteUrl,
    focusAreas: request.focusAreas,
    notes: request.notes,
    quotedPriceCad: request.quotedPriceCad,
    scopeSummary: request.scopeSummary,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    statusChangedAt: request.statusChangedAt,
  };
}

/**
 * Forward moves only, plus cancellation from any open state. The team may
 * step back from `quoted` to `in_review` when the customer asks for changes.
 */
const TRANSITIONS: Record<WebsiteRequestStatus, readonly WebsiteRequestStatus[]> = {
  submitted: ["in_review", "quoted", "rejected", "cancelled"],
  // Approval always follows a review: a request cannot jump from Pending to Approved.
  in_review: ["approved", "quoted", "rejected", "cancelled"],
  approved: ["in_review", "quoted", "in_progress", "rejected", "cancelled"],
  quoted: ["in_review", "approved", "in_progress", "rejected", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

/** One line of a request's history. Append-only, newest last. */
export type WebsiteRequestEvent = {
  id: string;
  requestId: string;
  kind:
    | "submitted"
    | "notified"
    | "status_changed"
    | "quote_updated"
    | "payment_updated"
    | "note";
  /** An administrator's email, "ops:<name>", or "customer". */
  actor: string | null;
  fromStatus: WebsiteRequestStatus | null;
  toStatus: WebsiteRequestStatus | null;
  fromPayment: WebsitePaymentStatus | null;
  toPayment: WebsitePaymentStatus | null;
  note: string | null;
  createdAt: string;
};

export function canTransitionWebsiteStatus(
  from: WebsiteRequestStatus,
  to: WebsiteRequestStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/**
 * The price a request is allowed to be quoted at. For a "starting at" service
 * that is any amount from the starting price up; for a fixed-price service
 * (the launch website service, $699.99) it is exactly that price, so the team
 * cannot quote a customer more than the price published on the site.
 */
export function isValidQuotedPrice(
  amountCad: number,
  priceCad: number,
  priceIsStartingAt = true,
): boolean {
  if (!Number.isFinite(amountCad)) return false;
  if (!priceIsStartingAt) {
    return Math.round(amountCad * 100) === Math.round(priceCad * 100);
  }
  return amountCad >= priceCad && amountCad <= 100_000;
}
