import type { FeatureId, PlanId } from "@/product/saas/entitlements";
import type { OrgStatus } from "@/product/saas/types";

export type AccountType = "pilot" | "demo" | "production";

export type DemoIndustry =
  | "plumbing"
  | "hvac"
  | "electrical"
  | "roofing"
  | "general"
  | "other";

/** Feature toggles stored on the business (demo / contractor settings). */
export type BusinessFeatureFlags = {
  aiReceptionist: boolean;
  appointmentBooking: boolean;
  callTransfer: boolean;
  missedCallRecovery: boolean;
  quoteFollowups: boolean;
};

export const DEFAULT_DEMO_FEATURES: BusinessFeatureFlags = {
  aiReceptionist: true,
  appointmentBooking: true,
  callTransfer: true,
  missedCallRecovery: true,
  quoteFollowups: true,
};

export type DemoBusinessProfile = {
  id: string;
  name: string;
  slug: string;
  industry: DemoIndustry | string;
  phoneE164: string | null;
  city: string | null;
  serviceArea: string;
  timezone: string;
  locale: "en" | "fr";
  accountType: AccountType;
  subscriptionPlan: PlanId;
  status: OrgStatus;
  features: BusinessFeatureFlags;
  missedCallClientId: string | null;
  ownerEmail?: string;
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDemoBusinessInput = {
  businessName: string;
  industry: DemoIndustry | string;
  ownerEmail: string;
  ownerName?: string;
  phoneNumber?: string;
  city?: string;
  serviceArea?: string;
  language: "en" | "fr";
  timezone?: string;
  accountType?: "demo";
  subscriptionPlan?: PlanId;
  accountStatus?: "active" | "suspended";
  features?: Partial<BusinessFeatureFlags>;
  /** Prevents duplicate creates from double-clicks / retries. */
  idempotencyKey?: string;
};

export type DemoSeedSummary = {
  customers: number;
  incomingCalls: number;
  missedCalls: number;
  leads: number;
  appointments: number;
  quotes: number;
  smsConversations: number;
};

export const DEMO_SEED_TARGETS: DemoSeedSummary = {
  customers: 10,
  incomingCalls: 15,
  missedCalls: 5,
  leads: 8,
  appointments: 4,
  quotes: 5,
  smsConversations: 6,
};

export const FEATURE_FLAG_TO_PLAN_FEATURE: Record<
  keyof BusinessFeatureFlags,
  FeatureId | null
> = {
  aiReceptionist: "AI_PHONE_ANSWERING",
  appointmentBooking: "APPOINTMENT_BOOKING",
  callTransfer: "AI_CALL_TRANSFER",
  missedCallRecovery: "MISSED_CALL_RECOVERY",
  quoteFollowups: "QUOTE_FOLLOW_UP",
};
