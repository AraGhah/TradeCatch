import { featuresForPlan, type PlanId } from "./entitlements";
import { newId, slugify } from "./ids";
import { normalizeEmail, type SaasStore } from "./store";
import {
  mergeBusinessFeatures,
  type MagicLink,
  type Membership,
  type Organization,
  type Session,
  type User,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

/** In-memory SaaS store for unit tests and local DX without Postgres. */
export function createMemorySaasStore(): SaasStore {
  const organizations = new Map<string, Organization>();
  const orgsBySlug = new Map<string, string>();
  const users = new Map<string, User>();
  const usersByEmail = new Map<string, string>();
  const memberships = new Map<string, Membership>();
  const magicLinks = new Map<string, MagicLink>();
  const sessions = new Map<string, Session>();
  const demoIdempotency = new Map<string, string>();

  return {
    async createOrganizationWithOwner(input) {
      const email = normalizeEmail(input.ownerEmail);
      const createdAt = nowIso();
      let user = usersByEmail.has(email)
        ? users.get(usersByEmail.get(email)!)!
        : null;
      if (!user) {
        user = {
          id: newId("usr"),
          email,
          name: input.ownerName.trim() || email.split("@")[0] || "Owner",
          locale: input.locale ?? "en",
          platformRole: "none",
          createdAt,
          updatedAt: createdAt,
        };
        users.set(user.id, user);
        usersByEmail.set(email, user.id);
      }

      let slug = slugify(input.slug || input.name);
      let suffix = 0;
      while (orgsBySlug.has(suffix ? `${slug}-${suffix}` : slug)) {
        suffix += 1;
      }
      if (suffix) slug = `${slug}-${suffix}`;

      const organization: Organization = {
        id: newId("org"),
        name: input.name.trim(),
        slug,
        plan: input.plan ?? "starter",
        status: input.status ?? "active",
        missedCallClientId: input.missedCallClientId ?? null,
        accountType: input.accountType ?? "pilot",
        industry: input.industry ?? null,
        phoneE164: input.phoneE164 ?? null,
        city: input.city ?? null,
        serviceArea: input.serviceArea ?? "",
        timezone: input.timezone?.trim() || "America/Toronto",
        localeDefault: input.locale ?? "en",
        features: mergeBusinessFeatures(input.features),
        createdAt,
        updatedAt: createdAt,
      };
      organizations.set(organization.id, organization);
      orgsBySlug.set(slug, organization.id);

      const membership: Membership = {
        id: newId("mem"),
        organizationId: organization.id,
        userId: user.id,
        role: "owner",
        createdAt,
      };
      memberships.set(membership.id, membership);

      return { organization, user, membership };
    },

    async getOrganization(id) {
      return organizations.get(id) ?? null;
    },

    async getOrganizationBySlug(slug) {
      const id = orgsBySlug.get(slug);
      return id ? (organizations.get(id) ?? null) : null;
    },

    async listOrganizations(filter) {
      return [...organizations.values()]
        .filter((org) =>
          filter?.accountType ? org.accountType === filter.accountType : true,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async updateOrganization(id, patch) {
      const org = organizations.get(id);
      if (!org) return null;
      const next: Organization = {
        ...org,
        name: patch.name?.trim() || org.name,
        plan: patch.plan ?? org.plan,
        status: patch.status ?? org.status,
        industry:
          patch.industry !== undefined ? patch.industry : org.industry,
        phoneE164:
          patch.phoneE164 !== undefined ? patch.phoneE164 : org.phoneE164,
        city: patch.city !== undefined ? patch.city : org.city,
        serviceArea:
          patch.serviceArea !== undefined ? patch.serviceArea : org.serviceArea,
        timezone: patch.timezone?.trim() || org.timezone,
        localeDefault: patch.localeDefault ?? org.localeDefault,
        features: patch.features
          ? mergeBusinessFeatures({ ...org.features, ...patch.features })
          : org.features,
        updatedAt: nowIso(),
      };
      organizations.set(id, next);
      return next;
    },

    async updateOrganizationPlan(id, plan) {
      return this.updateOrganization(id, { plan });
    },

    async deleteOrganization(id) {
      const org = organizations.get(id);
      if (!org) return false;
      organizations.delete(id);
      orgsBySlug.delete(org.slug);
      for (const [memId, mem] of [...memberships.entries()]) {
        if (mem.organizationId === id) memberships.delete(memId);
      }
      for (const [sesId, ses] of [...sessions.entries()]) {
        if (ses.organizationId === id) sessions.delete(sesId);
      }
      for (const [key, orgId] of [...demoIdempotency.entries()]) {
        if (orgId === id) demoIdempotency.delete(key);
      }
      return true;
    },

    async linkMissedCallClient(organizationId, clientId) {
      const org = organizations.get(organizationId);
      if (!org) return null;
      const next = {
        ...org,
        missedCallClientId: clientId,
        updatedAt: nowIso(),
      };
      organizations.set(organizationId, next);
      return next;
    },

    async findOrganizationByMissedCallClientId(clientId) {
      for (const org of organizations.values()) {
        if (org.missedCallClientId === clientId) return org;
      }
      return null;
    },

    async getUserByEmail(email) {
      const id = usersByEmail.get(normalizeEmail(email));
      return id ? (users.get(id) ?? null) : null;
    },

    async getUser(id) {
      return users.get(id) ?? null;
    },

    async setUserPlatformRole(userId, role) {
      const user = users.get(userId);
      if (!user) return null;
      const next = { ...user, platformRole: role, updatedAt: nowIso() };
      users.set(userId, next);
      return next;
    },

    async getMembership(organizationId, userId) {
      for (const m of memberships.values()) {
        if (m.organizationId === organizationId && m.userId === userId) {
          return m;
        }
      }
      return null;
    },

    async listMembershipsForUser(userId) {
      return [...memberships.values()].filter((m) => m.userId === userId);
    },

    async listMembershipsForOrganization(organizationId) {
      return [...memberships.values()].filter(
        (m) => m.organizationId === organizationId,
      );
    },

    async addMembership(input) {
      const existing = await this.getMembership(
        input.organizationId,
        input.userId,
      );
      if (existing) return existing;
      const membership: Membership = {
        id: newId("mem"),
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        createdAt: nowIso(),
      };
      memberships.set(membership.id, membership);
      return membership;
    },

    async createMagicLink(link) {
      magicLinks.set(link.tokenHash, link);
    },

    async consumeMagicLink(tokenHash, at) {
      const link = magicLinks.get(tokenHash);
      if (!link) return null;
      if (link.consumedAt) return null;
      if (Date.parse(link.expiresAt) <= Date.parse(at)) return null;
      const consumed = { ...link, consumedAt: at };
      magicLinks.set(tokenHash, consumed);
      return consumed;
    },

    async createSession(session) {
      sessions.set(session.id, session);
    },

    async getSession(id) {
      return sessions.get(id) ?? null;
    },

    async revokeSession(id, atIso) {
      const s = sessions.get(id);
      if (!s) return;
      sessions.set(id, { ...s, revokedAt: atIso });
    },

    async revokeUserSessions(userId, atIso) {
      for (const [id, s] of sessions) {
        if (s.userId === userId && !s.revokedAt) {
          sessions.set(id, { ...s, revokedAt: atIso });
        }
      }
    },

    async claimDemoIdempotencyKey(key, organizationId) {
      const existing = demoIdempotency.get(key);
      if (existing) return { claimed: false, organizationId: existing };
      demoIdempotency.set(key, organizationId);
      return { claimed: true, organizationId };
    },

    async getDemoIdempotency(key) {
      return demoIdempotency.get(key) ?? null;
    },
  };
}

/** Re-export for tests that assert starter entitlements after org create. */
export function planFeatures(plan: PlanId) {
  return featuresForPlan(plan);
}
