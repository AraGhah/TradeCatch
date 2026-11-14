import type { FeatureId, PlanId } from "./entitlements";
import type { AccountType, BusinessFeatureFlags } from "@/product/demo/types";
import { DEFAULT_DEMO_FEATURES } from "@/product/demo/types";

export type OrgStatus = "active" | "suspended" | "churned";
export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type PlatformRole = "none" | "admin";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  status: OrgStatus;
  missedCallClientId: string | null;
  accountType: AccountType;
  industry: string | null;
  phoneE164: string | null;
  city: string | null;
  serviceArea: string;
  timezone: string;
  localeDefault: "en" | "fr";
  features: BusinessFeatureFlags;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  locale: "en" | "fr";
  platformRole: PlatformRole;
  /** Populated only after trusted phone-ownership verification, never by settings forms. */
  notificationPhoneE164?: string;
  notificationPhoneVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Membership = {
  id: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
};

export type Session = {
  id: string;
  userId: string;
  organizationId: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  userAgent?: string;
  ip?: string;
};

export type MagicLink = {
  id: string;
  email: string;
  tokenHash: string;
  organizationId?: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
};

/** Cookie / middleware-safe session claims (HMAC-signed). */
export type SessionClaims = {
  sid: string;
  uid: string;
  oid: string;
  plan: PlanId;
  exp: number;
};

export type TenantContext = {
  session: Session;
  user: User;
  organization: Organization;
  membership: Membership;
  features: readonly FeatureId[];
  /** The person is on the administrator list. Identity only: use for UI hints, never for authorization. */
  isPlatformAdminIdentity: boolean;
  /** Administrator whose session has passed the second factor. The only flag that unlocks cross-tenant access. */
  isPlatformAdmin: boolean;
  /** Unix seconds when this request's access token expires (lets the page renew it in time). */
  accessExpiresAt?: number;
};

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
  plan?: PlanId;
  ownerEmail: string;
  ownerName: string;
  locale?: "en" | "fr";
  missedCallClientId?: string | null;
  accountType?: AccountType;
  industry?: string | null;
  phoneE164?: string | null;
  city?: string | null;
  serviceArea?: string;
  timezone?: string;
  features?: Partial<BusinessFeatureFlags>;
  status?: OrgStatus;
};

export type UpdateOrganizationInput = {
  name?: string;
  plan?: PlanId;
  status?: OrgStatus;
  industry?: string | null;
  phoneE164?: string | null;
  city?: string | null;
  serviceArea?: string;
  timezone?: string;
  localeDefault?: "en" | "fr";
  features?: Partial<BusinessFeatureFlags>;
};

export function mergeBusinessFeatures(
  partial?: Partial<BusinessFeatureFlags> | null,
): BusinessFeatureFlags {
  return { ...DEFAULT_DEMO_FEATURES, ...(partial ?? {}) };
}

/** A person's password, stored only as a salted slow hash (never the password). */
export type PasswordCredential = {
  userId: string;
  hash: string;
  updatedAt: string;
};

/**
 * A single-use link that lets someone choose a password: sent when TradeCatch
 * activates an account ("activation") or when they forget it ("reset").
 */
export type PasswordToken = {
  id: string;
  userId: string;
  tokenHash: string;
  kind: "activation" | "reset";
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
};

/**
 * One refresh token of a sign-in (session). Only the SHA-256 of the token is
 * stored. A token is used once: refreshing marks it rotated and issues a new
 * one. Presenting a rotated token again (after a short grace period for
 * parallel tabs) is treated as theft and ends the whole session.
 */
export type RefreshToken = {
  id: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  rotatedAt?: string;
};

export type AccountRecoveryStatus = "open" | "verified" | "completed" | "rejected";

/**
 * A request from someone who can no longer reach the email on their account.
 * Handled by a TradeCatch administrator, who must record how they verified the
 * person's identity before the account email can be changed.
 */
export type AccountRecoveryRequest = {
  id: string;
  status: AccountRecoveryStatus;
  /** The email the person says is on the account (normalized). */
  accountEmail: string;
  /** Where they can be reached now, and the address the account moves to. */
  contactEmail: string;
  contactName: string;
  businessName: string;
  phone?: string;
  details: string;
  locale: "en" | "fr";
  /** The matching user, resolved on the server. Never shown to the requester. */
  userId?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationMethod?: string;
  verificationNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
};
