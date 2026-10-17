import type {
  CreateOrganizationInput,
  MagicLink,
  Membership,
  Organization,
  Session,
  UpdateOrganizationInput,
  User,
} from "./types";
import type { PlanId } from "./entitlements";

export type SaasStore = {
  createOrganizationWithOwner(
    input: CreateOrganizationInput,
  ): Promise<{
    organization: Organization;
    user: User;
    membership: Membership;
  }>;
  getOrganization(id: string): Promise<Organization | null>;
  getOrganizationBySlug(slug: string): Promise<Organization | null>;
  listOrganizations(filter?: {
    accountType?: Organization["accountType"];
  }): Promise<Organization[]>;
  updateOrganization(
    id: string,
    patch: UpdateOrganizationInput,
  ): Promise<Organization | null>;
  updateOrganizationPlan(
    id: string,
    plan: PlanId,
  ): Promise<Organization | null>;
  deleteOrganization(id: string): Promise<boolean>;
  linkMissedCallClient(
    organizationId: string,
    clientId: string,
  ): Promise<Organization | null>;
  findOrganizationByMissedCallClientId(
    clientId: string,
  ): Promise<Organization | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  listUsers(ids: string[]): Promise<User[]>;
  setUserPlatformRole(
    userId: string,
    role: User["platformRole"],
  ): Promise<User | null>;
  getMembership(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null>;
  listMembershipsForUser(userId: string): Promise<Membership[]>;
  listMembershipsForOrganization(
    organizationId: string,
  ): Promise<Membership[]>;
  addMembership(input: {
    organizationId: string;
    userId: string;
    role: Membership["role"];
  }): Promise<Membership>;
  createMagicLink(link: MagicLink): Promise<void>;
  consumeMagicLink(
    tokenHash: string,
    nowIso: string,
  ): Promise<MagicLink | null>;
  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  listSessionsForUser(userId: string): Promise<Session[]>;
  revokeSession(id: string, atIso: string): Promise<void>;
  revokeUserSessions(userId: string, atIso: string): Promise<void>;
  /** Demo create idempotency — returns existing org id when key already used. */
  claimDemoIdempotencyKey(
    key: string,
    organizationId: string,
  ): Promise<{ claimed: boolean; organizationId: string }>;
  getDemoIdempotency(key: string): Promise<string | null>;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
