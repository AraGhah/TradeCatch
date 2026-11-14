import type {
  AccountRecoveryRequest,
  AccountRecoveryStatus,
  CreateOrganizationInput,
  MagicLink,
  PasswordCredential,
  PasswordToken,
  Membership,
  Organization,
  RefreshToken,
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
  /**
   * Changes the sign-in email of a user. Everything else (id, businesses,
   * memberships, data) is untouched. Fails when another user has that email.
   */
  updateUserEmail(
    userId: string,
    email: string,
  ): Promise<{ ok: true; user: User } | { ok: false; error: "not_found" | "email_taken" }>;
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
  setMembershipRole(
    organizationId: string,
    userId: string,
    role: Membership["role"],
  ): Promise<Membership | null>;
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
  /** The stored password hash for a user, or null when they have not chosen a password. */
  getPasswordCredential(userId: string): Promise<PasswordCredential | null>;
  setPasswordCredential(credential: PasswordCredential): Promise<void>;
  /** Removes the stored password hash, so the person must choose a new one with an emailed link. */
  deletePasswordCredential(userId: string): Promise<void>;
  createPasswordToken(token: PasswordToken): Promise<void>;
  /** Reads a token without using it (even if used or expired), so a form can be checked before the link is spent. */
  findPasswordToken(tokenHash: string): Promise<PasswordToken | null>;
  /** Marks a still-valid token of one of the kinds used and returns it; null when unknown, used or expired. */
  consumePasswordToken(
    tokenHash: string,
    nowIso: string,
  ): Promise<PasswordToken | null>;
  /** Cancels every unused token for the user (after a password is set, older links must stop working). */
  invalidatePasswordTokens(userId: string, atIso: string): Promise<void>;
  createRefreshToken(token: RefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshToken | null>;
  /**
   * Atomically marks a not-yet-rotated token as rotated and returns it; null
   * when the token is unknown or was already rotated (a concurrent caller won).
   */
  rotateRefreshToken(tokenHash: string, atIso: string): Promise<RefreshToken | null>;
  createRecoveryRequest(request: AccountRecoveryRequest): Promise<void>;
  getRecoveryRequest(id: string): Promise<AccountRecoveryRequest | null>;
  listRecoveryRequests(): Promise<AccountRecoveryRequest[]>;
  /**
   * Applies `patch` only while the request is still in `expected` status, so two
   * administrators cannot act on the same request twice. Null when it moved on.
   */
  updateRecoveryRequest(
    id: string,
    expected: AccountRecoveryStatus,
    patch: Partial<Omit<AccountRecoveryRequest, "id" | "createdAt">>,
  ): Promise<AccountRecoveryRequest | null>;
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
