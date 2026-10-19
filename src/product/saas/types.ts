import type { FeatureId, PlanId } from "./entitlements";
import type {
  AccountType,
  BusinessFeatureFlags,
} from "@/product/demo/types";
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
