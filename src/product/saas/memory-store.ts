import { featuresForPlan, type PlanId } from "./entitlements";
import { newId, slugify } from "./ids";
import {
  normalizeEmail,
  type SaasStore,
} from "./store";
import type {
  CreateOrganizationInput,
  MagicLink,
  Membership,
  Organization,
  Session,
  User,
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
        status: "active",
        missedCallClientId: input.missedCallClientId ?? null,
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

    async updateOrganizationPlan(id, plan) {
      const org = organizations.get(id);
      if (!org) return null;
      const next = { ...org, plan, updatedAt: nowIso() };
      organizations.set(id, next);
      return next;
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
  };
}

/** Re-export for tests that assert starter entitlements after org create. */
export function planFeatures(plan: PlanId) {
  return featuresForPlan(plan);
}
