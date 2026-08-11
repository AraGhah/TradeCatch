import type { FeatureId, PlanId } from "./entitlements";

export type OrgStatus = "active" | "suspended" | "churned";
export type MemberRole = "owner" | "admin" | "member";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  status: OrgStatus;
  missedCallClientId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  locale: "en" | "fr";
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
};

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
  plan?: PlanId;
  ownerEmail: string;
  ownerName: string;
  locale?: "en" | "fr";
  missedCallClientId?: string | null;
};
