import type {
  CreateOrganizationInput,
  MagicLink,
  Membership,
  Organization,
  Session,
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
  updateOrganizationPlan(
    id: string,
    plan: PlanId,
  ): Promise<Organization | null>;
  linkMissedCallClient(
    organizationId: string,
    clientId: string,
  ): Promise<Organization | null>;
  findOrganizationByMissedCallClientId(
    clientId: string,
  ): Promise<Organization | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  getMembership(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null>;
  listMembershipsForUser(userId: string): Promise<Membership[]>;
  createMagicLink(link: MagicLink): Promise<void>;
  consumeMagicLink(
    tokenHash: string,
    nowIso: string,
  ): Promise<MagicLink | null>;
  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  revokeSession(id: string, atIso: string): Promise<void>;
  revokeUserSessions(userId: string, atIso: string): Promise<void>;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
