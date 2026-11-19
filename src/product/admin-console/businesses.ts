import { z } from "zod";
import { PLAN_PRICES } from "@/lib/plans";
import { parsePhoneInput } from "@/product/crm/phone";
import { usableTimeZone } from "@/product/notifications/daily-summary";
import {
  FEATURE_IDS,
  PLAN_DISPLAY_NAMES,
  PLAN_FEATURES,
  PUBLIC_PLAN_IDS,
  featureIsLaunchEnabled,
  type FeatureId,
  type PlanId,
} from "@/product/saas/entitlements";
import { getSaasStore } from "@/product/saas/runtime";
import type { SaasStore } from "@/product/saas/store";
import { normalizeEmail } from "@/product/saas/store";
import type { Membership, OrgStatus, Organization, User } from "@/product/saas/types";
import { listSubscriptionRows, type SubscriptionRow } from "./billing-db";
import { adminDb, withAdvisoryLock } from "./db";

export type BusinessOwner = { userId: string; name: string; email: string };

export type BusinessSummary = {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  planLabel: string;
  status: OrgStatus;
  accountType: string;
  city: string | null;
  industry: string | null;
  phoneE164: string | null;
  owner: BusinessOwner | null;
  /** The subscription state TradeCatch last synchronized from Stripe, if any. */
  subscription: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null } | null;
  /** What the plan costs per month from the catalog while the account is active; 0 for demos and inactive accounts. */
  monthlyCad: number;
  createdAt: string;
  updatedAt: string;
};

export type BusinessDeps = {
  store: SaasStore;
  subscriptions: () => Promise<SubscriptionRow[]>;
};

export function defaultBusinessDeps(): BusinessDeps {
  return {
    store: getSaasStore(),
    subscriptions: () => listSubscriptionRows(adminDb()).catch(() => []),
  };
}

async function ownerOf(store: SaasStore, organizationId: string): Promise<BusinessOwner | null> {
  const memberships = await store.listMembershipsForOrganization(organizationId);
  const owner =
    memberships.find((m) => m.role === "owner") ?? memberships.find((m) => m.role === "admin") ?? memberships[0];
  if (!owner) return null;
  const user = await store.getUser(owner.userId);
  return user ? { userId: user.id, name: user.name, email: user.email } : null;
}

function summarize(
  org: Organization,
  owner: BusinessOwner | null,
  sub: SubscriptionRow | undefined,
): BusinessSummary {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    planLabel: PLAN_DISPLAY_NAMES[org.plan],
    status: org.status,
    accountType: org.accountType,
    city: org.city,
    industry: org.industry,
    phoneE164: org.phoneE164,
    owner,
    subscription: sub
      ? {
          status: sub.status,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null,
    monthlyCad:
      org.accountType === "demo" || org.status !== "active" ? 0 : PLAN_PRICES[org.plan].monthly,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type BusinessQuery = {
  q?: string;
  status?: string;
  plan?: string;
  accountType?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

export type BusinessPage = {
  rows: BusinessSummary[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
};

export async function listBusinesses(
  query: BusinessQuery,
  deps: BusinessDeps = defaultBusinessDeps(),
): Promise<BusinessPage> {
  const all = await deps.store.listOrganizations();
  const q = query.q?.trim().toLowerCase() ?? "";

  // A search that looks like an email finds the owner's businesses too.
  let byOwnerEmail = new Set<string>();
  if (q.includes("@")) {
    const user = await deps.store.getUserByEmail(normalizeEmail(q));
    if (user) {
      byOwnerEmail = new Set(
        (await deps.store.listMembershipsForUser(user.id)).map((m) => m.organizationId),
      );
    }
  }

  const filtered = all
    .filter((org) => {
      if (query.status && org.status !== query.status) return false;
      if (query.plan && org.plan !== query.plan) return false;
      if (query.accountType && org.accountType !== query.accountType) return false;
      if (query.from && org.createdAt.slice(0, 10) < query.from) return false;
      if (query.to && org.createdAt.slice(0, 10) > query.to) return false;
      if (!q) return true;
      if (byOwnerEmail.has(org.id)) return true;
      return [org.name, org.slug, org.city ?? "", org.industry ?? "", org.phoneE164 ?? "", org.id]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

  const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(pages, Math.max(1, query.page));
  const slice = filtered.slice((page - 1) * query.pageSize, page * query.pageSize);

  const subs = await deps.subscriptions();
  const subByOrg = new Map<string, SubscriptionRow>();
  // Newest-synchronized first (listSubscriptionRows orders by synced_at desc).
  for (const row of subs) if (!subByOrg.has(row.organizationId)) subByOrg.set(row.organizationId, row);

  const rows = await Promise.all(
    slice.map(async (org) => summarize(org, await ownerOf(deps.store, org.id), subByOrg.get(org.id))),
  );
  return { rows, total: filtered.length, page, pages, pageSize: query.pageSize };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type IntegrationState = "connected" | "not_connected" | "unavailable";
export type IntegrationStatus = {
  key: "phone_line" | "voice_receptionist" | "calendar" | "gmail" | "billing";
  state: IntegrationState;
  detail: string | null;
};

export type BusinessDetail = BusinessSummary & {
  members: { userId: string; name: string; email: string; role: string }[];
  serviceArea: string;
  timezone: string;
  localeDefault: "en" | "fr";
  /** What the plan grants, and whether each is currently available (launch switches). */
  services: { feature: FeatureId; included: boolean; available: boolean }[];
  receptionist: {
    linked: boolean;
    activated: boolean | null;
    phoneNumber: string | null;
  };
  integrations: IntegrationStatus[];
};

export type DetailProbes = {
  /** Phone line + receptionist facts. */
  receptionist(org: Organization): Promise<BusinessDetail["receptionist"]>;
  calendar(organizationId: string): Promise<{ connected: boolean; detail: string | null } | null>;
  gmail(organizationId: string, ownerUserId: string | null): Promise<{ connected: boolean; detail: string | null } | null>;
};

async function defaultProbes(): Promise<DetailProbes> {
  return {
    async receptionist(org) {
      if (!org.missedCallClientId) {
        return { linked: false, activated: null, phoneNumber: null };
      }
      let phoneNumber: string | null = null;
      let activated: boolean | null = null;
      try {
        const { getMissedCallReadStore } = await import("@/product/missed-call/runtime");
        const client = await getMissedCallReadStore().getClient(org.missedCallClientId);
        phoneNumber = client?.smsFromNumber ?? null;
      } catch {
        phoneNumber = null;
      }
      try {
        const { getReceptionistRuntime } = await import("@/product/receptionist/runtime");
        const profile = await getReceptionistRuntime().profileStore.getProfile(org.id);
        activated = profile ? profile.activated : null;
      } catch {
        activated = null;
      }
      return { linked: true, activated, phoneNumber };
    },
    async calendar(organizationId) {
      try {
        const { getSchedulingStore } = await import("@/product/scheduling/runtime");
        const connection = await getSchedulingStore().getConnection(organizationId);
        return connection
          ? { connected: connection.status === "connected", detail: String(connection.status) }
          : { connected: false, detail: null };
      } catch {
        return null;
      }
    },
    async gmail(organizationId, ownerUserId) {
      if (!ownerUserId) return { connected: false, detail: null };
      try {
        const { getGmailStore } = await import("@/product/gmail/runtime");
        const account = await getGmailStore().getAccount(organizationId, ownerUserId);
        return account
          ? { connected: account.status === "connected", detail: String(account.status) }
          : { connected: false, detail: null };
      } catch {
        return null;
      }
    },
  };
}

export async function getBusinessDetail(
  id: string,
  deps: BusinessDeps = defaultBusinessDeps(),
  probes?: DetailProbes,
): Promise<BusinessDetail | null> {
  const org = await deps.store.getOrganization(id);
  if (!org) return null;
  const probe = probes ?? (await defaultProbes());
  const memberships: Membership[] = await deps.store.listMembershipsForOrganization(id);
  const users: User[] = await deps.store.listUsers(memberships.map((m) => m.userId));
  const byId = new Map(users.map((u) => [u.id, u]));
  const owner = await ownerOf(deps.store, id);
  const subs = (await deps.subscriptions()).filter((s) => s.organizationId === id);

  const included = new Set<FeatureId>(PLAN_FEATURES[org.plan]);
  const services = FEATURE_IDS.map((feature) => ({
    feature,
    included: included.has(feature),
    available: included.has(feature) && featureIsLaunchEnabled(feature),
  }));

  const receptionist = await probe.receptionist(org);
  const calendar = await probe.calendar(id);
  const gmail = await probe.gmail(id, owner?.userId ?? null);

  const state = (value: { connected: boolean; detail: string | null } | null): IntegrationState =>
    value === null ? "unavailable" : value.connected ? "connected" : "not_connected";

  const integrations: IntegrationStatus[] = [
    {
      key: "phone_line",
      state: receptionist.linked && receptionist.phoneNumber ? "connected" : "not_connected",
      detail: receptionist.phoneNumber,
    },
    {
      key: "voice_receptionist",
      state:
        receptionist.activated === null
          ? receptionist.linked
            ? "unavailable"
            : "not_connected"
          : receptionist.activated
            ? "connected"
            : "not_connected",
      detail: receptionist.activated === false ? "not activated" : null,
    },
    { key: "calendar", state: state(calendar), detail: calendar?.detail ?? null },
    { key: "gmail", state: state(gmail), detail: gmail?.detail ?? null },
    {
      key: "billing",
      state: subs.length ? "connected" : "not_connected",
      detail: subs[0]?.status ?? null,
    },
  ];

  return {
    ...summarize(org, owner, subs[0]),
    members: memberships.map((m) => ({
      userId: m.userId,
      name: byId.get(m.userId)?.name ?? "",
      email: byId.get(m.userId)?.email ?? "",
      role: m.role,
    })),
    serviceArea: org.serviceArea,
    timezone: org.timezone,
    localeDefault: org.localeDefault,
    services,
    receptionist,
    integrations,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const phoneField = z
  .string()
  .trim()
  .max(30)
  .transform((value, ctx) => {
    if (!value) return null;
    const parsed = parsePhoneInput(value);
    if (!parsed) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return parsed;
  })
  .nullable()
  .optional();

export const createBusinessSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(120),
    ownerName: z.string().trim().min(1).max(120),
    ownerEmail: z.string().trim().toLowerCase().email().max(200),
    /** Only the plans sold today; legacy plans are never given to new customers. */
    plan: z.enum(PUBLIC_PLAN_IDS),
    locale: z.enum(["en", "fr"]).default("en"),
    phone: phoneField,
    city: z.string().trim().max(80).optional(),
    industry: z.string().trim().max(80).optional(),
    /** A paying customer, or someone still on a pilot. Never a demo (those have their own tools). */
    accountType: z.enum(["production", "pilot"]).default("production"),
    /** Email the owner a single-use link to choose their password. Defaults to on. */
    sendInvite: z.boolean().default(true),
  })
  .strict();
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export type CreateBusinessResult =
  | {
      ok: true;
      organization: Organization;
      owner: User;
      invite: { requested: boolean; sent: boolean };
    }
  | { ok: false; error: "email_exists" | "failed" };

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Serializes work for one key inside this process. Two clicks on "Create" a
 * moment apart run one after the other, so the second sees the first's account
 * and is refused instead of making a duplicate.
 */
async function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  inFlight.set(key, next);
  try {
    return await next;
  } finally {
    if (inFlight.get(key) === next) inFlight.delete(key);
  }
}

/**
 * Creates a customer account by hand. Public registration stays closed: this is
 * the only way an account comes into being besides the founder's ops
 * provisioning, and it needs an administrator with the business.create role.
 *
 * No password is chosen or stored here. The owner gets a single-use link to
 * choose their own; until they do, nobody can sign in as them.
 */
export async function createBusiness(
  input: CreateBusinessInput,
  deps: {
    store: SaasStore;
    sendInvite: (args: {
      email: string;
      locale: "en" | "fr";
      organizationId: string;
    }) => Promise<{ ok: boolean }>;
    /** Cross-instance lock for one owner email. Defaults to a Postgres advisory lock. */
    lock?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  },
): Promise<CreateBusinessResult> {
  const email = normalizeEmail(input.ownerEmail);
  const lock = deps.lock ?? ((key, work) => withAdvisoryLock(adminDb(), key, work));
  return exclusive(`create:${email}`, () => lock(`tc-admin-create:${email}`, async () => {
    const existing = await deps.store.getUserByEmail(email);
    if (existing && (await deps.store.listMembershipsForUser(existing.id)).length > 0) {
      return { ok: false as const, error: "email_exists" as const };
    }
    let created: Awaited<ReturnType<SaasStore["createOrganizationWithOwner"]>>;
    try {
      created = await deps.store.createOrganizationWithOwner({
        name: input.organizationName,
        ownerEmail: email,
        ownerName: input.ownerName,
        locale: input.locale,
        plan: input.plan,
        phoneE164: input.phone ?? null,
        city: input.city || null,
        industry: input.industry || null,
        accountType: input.accountType,
      });
    } catch {
      return { ok: false as const, error: "failed" as const };
    }
    let sent = false;
    if (input.sendInvite) {
      sent = await deps
        .sendInvite({
          email,
          locale: input.locale,
          organizationId: created.organization.id,
        })
        .then((r) => r.ok)
        .catch(() => false);
    }
    return {
      ok: true as const,
      organization: created.organization,
      owner: created.user,
      invite: { requested: input.sendInvite, sent },
    };
  }));
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** The business information an administrator may correct. Plan and status have their own, confirmed, actions. */
export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    industry: z.string().trim().max(80).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    phone: phoneField,
    serviceArea: z.string().trim().max(300).optional(),
    timezone: z
      .string()
      .trim()
      .max(60)
      .refine((zone) => usableTimeZone(zone) === zone, "invalid_timezone")
      .optional(),
    localeDefault: z.enum(["en", "fr"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "empty_update" });
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;

export const BUSINESS_AUDIT_FIELDS = [
  "name",
  "industry",
  "city",
  "phoneE164",
  "serviceArea",
  "timezone",
  "localeDefault",
] as const;

export type UpdateBusinessResult =
  | {
      ok: true;
      before: Organization;
      after: Organization;
    }
  | { ok: false; error: "not_found" | "no_change" };

export async function updateBusiness(
  id: string,
  input: UpdateBusinessInput,
  store: SaasStore = getSaasStore(),
): Promise<UpdateBusinessResult> {
  const before = await store.getOrganization(id);
  if (!before) return { ok: false, error: "not_found" };
  const patch: Parameters<SaasStore["updateOrganization"]>[1] = {};
  if (input.name !== undefined && input.name !== before.name) patch.name = input.name;
  if (input.industry !== undefined && (input.industry || null) !== before.industry) {
    patch.industry = input.industry || null;
  }
  if (input.city !== undefined && (input.city || null) !== before.city) patch.city = input.city || null;
  if (input.phone !== undefined && (input.phone ?? null) !== before.phoneE164) {
    patch.phoneE164 = input.phone ?? null;
  }
  if (input.serviceArea !== undefined && input.serviceArea !== before.serviceArea) {
    patch.serviceArea = input.serviceArea;
  }
  if (input.timezone !== undefined && input.timezone !== before.timezone) patch.timezone = input.timezone;
  if (input.localeDefault !== undefined && input.localeDefault !== before.localeDefault) {
    patch.localeDefault = input.localeDefault;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "no_change" };
  const after = await store.updateOrganization(id, patch);
  if (!after) return { ok: false, error: "not_found" };
  return { ok: true, before, after };
}
