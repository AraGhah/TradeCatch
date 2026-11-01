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
  "quoted",
  "in_progress",
  "delivered",
  "cancelled",
] as const;
export type WebsiteRequestStatus = (typeof WEBSITE_REQUEST_STATUSES)[number];

/** Statuses a request can no longer leave. */
export const TERMINAL_WEBSITE_STATUSES: readonly WebsiteRequestStatus[] = [
  "delivered",
  "cancelled",
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
  /** Set by the team when the scope is agreed. Always >= the starting price. */
  quotedPriceCad: number | null;
  /** The scope the team wrote back, shown to the customer. */
  scopeSummary: string | null;
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
  submitted: ["in_review", "quoted", "cancelled"],
  in_review: ["quoted", "cancelled"],
  quoted: ["in_review", "in_progress", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransitionWebsiteStatus(
  from: WebsiteRequestStatus,
  to: WebsiteRequestStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** The price a request is allowed to be quoted at: never below the starting price. */
export function isValidQuotedPrice(amountCad: number, startingPriceCad: number): boolean {
  return Number.isFinite(amountCad) && amountCad >= startingPriceCad && amountCad <= 100_000;
}
