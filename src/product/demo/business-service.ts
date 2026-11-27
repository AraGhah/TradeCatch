import { z } from "zod";
import { getGrowthStore } from "@/product/growth";
import { demoClientAccount } from "@/product/missed-call/fixtures";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getPgPool } from "@/lib/postgres-pool";
import { purgeBusinessVoice } from "@/product/receptionist/custom-voice/runtime";
import { newId } from "@/product/saas/ids";
import { getSaasStore } from "@/product/saas/runtime";
import { normalizeEmail } from "@/product/saas/store";
import type { Organization, User } from "@/product/saas/types";
import { getStarterStore } from "@/product/starter";
import {
  DEFAULT_DEMO_FEATURES,
  DEMO_SEED_TARGETS,
  type CreateDemoBusinessInput,
  type DemoBusinessProfile,
  type DemoSeedSummary,
} from "./types";
import { PLAN_IDS } from "@/product/saas/entitlements";

export const createDemoBusinessSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120),
    industry: z.string().trim().min(2).max(60),
    ownerEmail: z.string().trim().email().max(200),
    ownerName: z.string().trim().min(1).max(120).optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "Phone must be E.164")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    city: z.string().trim().max(80).optional(),
    serviceArea: z.string().trim().max(240).optional(),
    language: z.enum(["en", "fr"]),
    timezone: z.string().trim().min(3).max(64).optional(),
    accountType: z.literal("demo").optional().default("demo"),
    subscriptionPlan: z
      .enum(PLAN_IDS)
      .optional()
      .default("professional"),
    accountStatus: z
      .enum(["active", "suspended"])
      .optional()
      .default("active"),
    features: z
      .object({
        aiReceptionist: z.boolean().optional(),
        appointmentBooking: z.boolean().optional(),
        callTransfer: z.boolean().optional(),
        missedCallRecovery: z.boolean().optional(),
        quoteFollowups: z.boolean().optional(),
      })
      .optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .strict();

const DEMO_CUSTOMERS = [
  { name: "Sophie Tremblay", phone: "+15145551001", city: "Montréal" },
  { name: "Marc Gagnon", phone: "+15145551002", city: "Laval" },
  { name: "Nadia Benali", phone: "+15145551003", city: "Longueuil" },
  { name: "Jean-Pierre Roy", phone: "+15145551004", city: "Montréal" },
  { name: "Emily Chen", phone: "+15145551005", city: "Brossard" },
  { name: "Olivier Fortin", phone: "+15145551006", city: "Laval" },
  { name: "Camille Dubois", phone: "+15145551007", city: "Montréal" },
  { name: "Hassan Ali", phone: "+15145551008", city: "Terrebonne" },
  { name: "Laura Martin", phone: "+15145551009", city: "Montréal" },
  { name: "Antoine Lefebvre", phone: "+15145551010", city: "Laval" },
] as const;

export function toDemoBusinessProfile(
  org: Organization,
  owner?: User | null,
): DemoBusinessProfile {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    industry: org.industry || "general",
    phoneE164: org.phoneE164,
    city: org.city,
    serviceArea: org.serviceArea,
    timezone: org.timezone,
    locale: org.localeDefault,
    accountType: org.accountType,
    subscriptionPlan: org.plan,
    status: org.status,
    features: org.features,
    missedCallClientId: org.missedCallClientId,
    ownerEmail: owner?.email,
    ownerName: owner?.name,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

async function ensureDemoMissedCallClient(input: {
  organizationId: string;
  businessName: string;
  phoneE164?: string | null;
  timezone: string;
  city?: string | null;
  serviceArea?: string;
}): Promise<string> {
  const clientId = `demo_${input.organizationId.replace(/^org_/, "").slice(0, 16)}`;
  const smsFrom = input.phoneE164?.trim() || "+15145550100";
  const tokens = [
    ...(input.city ? [input.city.toLowerCase()] : []),
    ...(input.serviceArea || "")
      .split(/[,/]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ];
  const client = demoClientAccount({
    id: clientId,
    name: `${input.businessName} (Demo)`,
    contractorDisplayName: input.businessName,
    timezone: input.timezone,
    smsFromNumber: smsFrom,
    approvedServiceAreas: tokens.length
      ? [
          {
            id: "area_primary",
            label: input.city || "Service area",
            matchTokens: tokens,
          },
        ]
      : undefined,
  });

  const { store } = await ensureMissedCallReady();
  await store.saveClient(client);

  const saas = getSaasStore();
  await saas.linkMissedCallClient(input.organizationId, clientId);
  return clientId;
}

export async function createDemoBusiness(
  input: CreateDemoBusinessInput,
): Promise<{
  organization: Organization;
  user: User;
  profile: DemoBusinessProfile;
  created: boolean;
}> {
  const saas = getSaasStore();
  const email = normalizeEmail(input.ownerEmail);

  if (input.idempotencyKey) {
    const existingId = await saas.getDemoIdempotency(input.idempotencyKey);
    if (existingId) {
      const organization = await saas.getOrganization(existingId);
      if (organization) {
        const user =
          (await saas.getUserByEmail(email)) ??
          (await saas.getUser(
            (
              await saas.listMembershipsForOrganization(organization.id)
            )[0]!.userId,
          ))!;
        return {
          organization,
          user,
          profile: toDemoBusinessProfile(organization, user),
          created: false,
        };
      }
    }
  }

  const created = await saas.createOrganizationWithOwner({
    name: input.businessName,
    plan: input.subscriptionPlan ?? "professional",
    ownerEmail: email,
    ownerName: input.ownerName?.trim() || email.split("@")[0] || "Demo Owner",
    locale: input.language,
    accountType: "demo",
    industry: input.industry,
    phoneE164: input.phoneNumber || null,
    city: input.city || null,
    serviceArea: input.serviceArea || "",
    timezone: input.timezone || "America/Toronto",
    features: { ...DEFAULT_DEMO_FEATURES, ...input.features },
    status: input.accountStatus === "suspended" ? "suspended" : "active",
  });

  if (input.idempotencyKey) {
    await saas.claimDemoIdempotencyKey(
      input.idempotencyKey,
      created.organization.id,
    );
  }

  const clientId = await ensureDemoMissedCallClient({
    organizationId: created.organization.id,
    businessName: created.organization.name,
    phoneE164: created.organization.phoneE164,
    timezone: created.organization.timezone,
    city: created.organization.city,
    serviceArea: created.organization.serviceArea,
  });

  const organization =
    (await saas.getOrganization(created.organization.id)) ?? {
      ...created.organization,
      missedCallClientId: clientId,
    };

  const growth = getGrowthStore();
  await growth.upsertOrgSettings(organization.id, {
    localeDefault: organization.localeDefault,
    notifyEmail: email,
  });

  return {
    organization,
    user: created.user,
    profile: toDemoBusinessProfile(organization, created.user),
    created: true,
  };
}

export async function listDemoBusinesses(): Promise<DemoBusinessProfile[]> {
  const saas = getSaasStore();
  const orgs = await saas.listOrganizations({ accountType: "demo" });
  const profiles: DemoBusinessProfile[] = [];
  for (const org of orgs) {
    const members = await saas.listMembershipsForOrganization(org.id);
    const ownerMem = members.find((m) => m.role === "owner") ?? members[0];
    const owner = ownerMem ? await saas.getUser(ownerMem.userId) : null;
    profiles.push(toDemoBusinessProfile(org, owner));
  }
  return profiles;
}

/** The visits the demo seed puts on the calendar are marked so a reset finds exactly those. */
const DEMO_VISIT_PREFIX = "[SIMULATED] Visit";

/** The open time closest to 10:00 local, if the day has one from 09:00 up to noon. */
function midMorningStart(
  slots: { startAt: string; time: string }[],
): string | undefined {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  let best: { startAt: string; distance: number } | undefined;
  for (const slot of slots) {
    const at = minutes(slot.time);
    if (at < 9 * 60 || at >= 12 * 60) continue;
    const distance = Math.abs(at - 10 * 60);
    if (!best || distance < best.distance) best = { startAt: slot.startAt, distance };
  }
  return best?.startAt;
}

/**
 * Sample visits go through the same scheduling engine as every real booking,
 * so the demo calendar shows them in the business's own hours and time zone.
 * They are practice bookings: nothing is texted and no outside calendar is
 * touched.
 */
async function seedDemoCalendar(
  organizationId: string,
  customers: { name: string; phone?: string; city: string }[],
): Promise<void> {
  try {
    const { getSchedulingService } = await import("@/product/scheduling/runtime");
    const scheduling = getSchedulingService();
    // One mid-morning time on each of the next few open days. The open
    // times come grouped by the business's own days (not UTC days) and are
    // not capped, so the picks do not depend on what time of day the demo is
    // seeded: a day that is already half over simply has no mid-morning left
    // and is skipped, instead of putting a visit at closing time.
    const thisMonth = await scheduling.availabilityMonth({ organizationId });
    const [year, month] = thisMonth.month.split("-").map(Number) as [number, number];
    const nextMonth = await scheduling.availabilityMonth({
      organizationId,
      month: month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`,
    });
    const days = { ...thisMonth.days, ...nextMonth.days };
    const picks = Object.keys(days)
      .sort()
      .map((day) => midMorningStart(days[day] ?? []))
      .filter((startAt): startAt is string => Boolean(startAt))
      .slice(0, customers.length);
    for (const [i, startAt] of picks.entries()) {
      const c = customers[i]!;
      await scheduling.book({
        organizationId,
        serviceName: `${DEMO_VISIT_PREFIX} · ${c.city}`,
        startAt,
        customerName: c.name,
        customerPhoneE164: c.phone,
        source: "simulation",
        simulated: true,
        requestIfUnavailable: false,
        idempotencyKey: `demo-visit:${organizationId}:${startAt}`,
      });
    }
  } catch (err) {
    // A demo without sample visits is still a working demo.
    console.warn("[demo] sample calendar seed skipped", err);
  }
}

/** Takes the demo's sample visits off the calendar. Real bookings are never touched. */
async function clearDemoCalendar(organizationId: string): Promise<void> {
  try {
    const { getSchedulingStore } = await import("@/product/scheduling/runtime");
    const store = getSchedulingStore();
    for (const row of await store.listAppointments(organizationId)) {
      if (
        row.simulated &&
        row.status !== "canceled" &&
        row.serviceName.startsWith(DEMO_VISIT_PREFIX)
      ) {
        row.status = "canceled";
        row.cancelReason = "demo_reset";
        row.updatedAt = new Date().toISOString();
        await store.saveAppointment(row);
      }
    }
  } catch (err) {
    console.warn("[demo] sample calendar wipe skipped", err);
  }
}

async function wipeOrgScopedDemoData(organizationId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const durable = process.env.MISSED_CALL_DURABLE_STORE === "1";

  if (databaseUrl && durable) {
    await clearDemoCalendar(organizationId);
    const pool = getPgPool(databaseUrl);
    // Strictly scoped by organization_id — never touches other businesses.
    await pool.query(
      `DELETE FROM tc_quote_messages
       WHERE thread_id IN (
         SELECT id FROM tc_quote_threads WHERE organization_id = $1
       )`,
      [organizationId],
    );
    await pool.query(`DELETE FROM tc_quote_threads WHERE organization_id = $1`, [
      organizationId,
    ]);
    await pool.query(
      `DELETE FROM tc_website_leads WHERE organization_id = $1`,
      [organizationId],
    );
    await pool.query(`DELETE FROM tc_inbox_items WHERE organization_id = $1`, [
      organizationId,
    ]);
    await pool.query(
      `DELETE FROM tc_appointments WHERE organization_id = $1`,
      [organizationId],
    );
    await pool.query(
      `DELETE FROM tc_pipeline_cards WHERE organization_id = $1`,
      [organizationId],
    );
    await pool.query(
      `DELETE FROM tc_timeline_events WHERE organization_id = $1`,
      [organizationId],
    );
    await pool.query(
      `DELETE FROM tc_review_requests WHERE organization_id = $1`,
      [organizationId],
    );
    await pool.query(
      `DELETE FROM tc_revenue_events WHERE organization_id = $1`,
      [organizationId],
    );
    try {
      const { getCrmService } = await import("@/product/crm/runtime");
      await getCrmService().clearOrganization(organizationId);
    } catch (err) {
      console.warn("[crm] demo wipe skipped", err);
    }
    return;
  }

  // Memory / local: close what we can so dashboards look empty-ish.
  await clearDemoCalendar(organizationId);
  const growth = getGrowthStore();
  const starter = getStarterStore();
  for (const appt of await growth.listAppointments(organizationId)) {
    await growth.updateAppointment(appt.id, organizationId, {
      status: "cancelled",
      notes: "[demo-reset]",
    });
  }
  for (const card of await growth.listPipeline(organizationId)) {
    await growth.updatePipelineStage(card.id, organizationId, "lost");
  }
  for (const thread of await starter.listQuoteThreads(organizationId)) {
    await starter.updateQuoteThread(thread.id, organizationId, {
      status: "stopped",
      stopReason: "manual_pause",
    });
  }
  for (const lead of await starter.listWebsiteLeads(organizationId)) {
    await starter.updateWebsiteLead(lead.id, organizationId, {
      status: "closed",
    });
  }
  for (const item of await starter.listInbox(organizationId)) {
    await starter.updateInboxItem(item.id, organizationId, {
      status: "resolved",
    });
  }
  try {
    const { getCrmService } = await import("@/product/crm/runtime");
    await getCrmService().clearOrganization(organizationId);
  } catch (err) {
    console.warn("[crm] demo wipe skipped", err);
  }
}

export async function resetDemoBusiness(
  organizationId: string,
  opts: { reseed?: boolean } = {},
): Promise<{ ok: true; reseeded: boolean; summary?: DemoSeedSummary }> {
  const saas = getSaasStore();
  const org = await saas.getOrganization(organizationId);
  if (!org || org.accountType !== "demo") {
    throw new Error("Demo business not found");
  }

  await wipeOrgScopedDemoData(organizationId);

  const growth = getGrowthStore();
  const members = await saas.listMembershipsForOrganization(organizationId);
  const ownerMem = members.find((m) => m.role === "owner");
  const owner = ownerMem ? await saas.getUser(ownerMem.userId) : null;

  await growth.upsertOrgSettings(organizationId, {
    localeDefault: org.localeDefault,
    notifyEmail: owner?.email,
    googleReviewUrl: undefined,
    crmWebhookUrl: undefined,
    onboardingCompletedAt: undefined,
  });

  await saas.updateOrganization(organizationId, {
    features: DEFAULT_DEMO_FEATURES,
    status: "active",
  });

  if (opts.reseed) {
    const summary = await seedDemoBusiness(organizationId);
    return { ok: true, reseeded: true, summary };
  }
  return { ok: true, reseeded: false };
}

export async function seedDemoBusiness(
  organizationId: string,
): Promise<DemoSeedSummary> {
  const saas = getSaasStore();
  const org = await saas.getOrganization(organizationId);
  if (!org || org.accountType !== "demo") {
    throw new Error("Demo business not found");
  }

  let clientId = org.missedCallClientId;
  if (!clientId) {
    clientId = await ensureDemoMissedCallClient({
      organizationId: org.id,
      businessName: org.name,
      phoneE164: org.phoneE164,
      timezone: org.timezone,
      city: org.city,
      serviceArea: org.serviceArea,
    });
  }

  const starter = getStarterStore();
  const growth = getGrowthStore();
  const now = Date.now();
  const stamp = now.toString(36);

  for (let i = 0; i < DEMO_SEED_TARGETS.customers; i += 1) {
    const c = DEMO_CUSTOMERS[i]!;
    await starter.createWebsiteLead({
      organizationId,
      name: c.name,
      email: `demo.${i}.${stamp}@example.demo`,
      phoneE164: c.phone,
      message: `[SIMULATED] Demo customer from ${c.city}`,
      serviceRequested: org.industry || "service",
      status: "new",
      conversationMode: "auto",
      idempotencyKey: `demo-customer-${organizationId}-${stamp}-${i}`,
      openingSmsSent: false,
    });
  }

  for (let i = 0; i < DEMO_SEED_TARGETS.leads; i += 1) {
    const c = DEMO_CUSTOMERS[i % DEMO_CUSTOMERS.length]!;
    await growth.upsertPipelineCard({
      organizationId,
      stage: i % 2 === 0 ? "new" : "contacted",
      title: `[SIMULATED] ${c.name} · ${org.industry || "job"}`,
      source: "manual",
      customerPhoneE164: c.phone,
      estimatedValue: 150 + i * 75,
    });
  }

  // The appointments live where the calendar, the dashboard and the
  // receptionist all look: the scheduling store, under its rules.
  await seedDemoCalendar(
    organizationId,
    DEMO_CUSTOMERS.slice(0, DEMO_SEED_TARGETS.appointments),
  );

  for (let i = 0; i < DEMO_SEED_TARGETS.quotes; i += 1) {
    const c = DEMO_CUSTOMERS[i]!;
    const createdAt = new Date().toISOString();
    await starter.createQuoteThread({
      id: newId("qth"),
      organizationId,
      clientAccountId: clientId,
      customerPhoneE164: c.phone,
      customerName: c.name,
      quoteRef: `DEMO-Q-${i + 1}`,
      quoteAmount: 220 + i * 40,
      quoteSentAt: new Date(now - i * 3600_000).toISOString(),
      locale: org.localeDefault,
      status: "active",
      conversationMode: "auto",
      nextStepIndex: 0,
      nextRunAt: new Date(now + 3600_000).toISOString(),
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
    });
  }

  for (let i = 0; i < DEMO_SEED_TARGETS.smsConversations; i += 1) {
    const c = DEMO_CUSTOMERS[i]!;
    await starter.upsertInboxItem({
      organizationId,
      kind: "website_lead",
      refId: `demo-sms-${stamp}-${i}`,
      title: `[SIMULATED] SMS with ${c.name}`,
      reason: "Simulated conversation, dry-run only",
      status: "open",
    });
  }

  for (let i = 0; i < DEMO_SEED_TARGETS.incomingCalls; i += 1) {
    await growth.addTimelineEvent({
      organizationId,
      kind: "demo_incoming_call",
      title: `[SIMULATED] Incoming call #${i + 1}`,
      detail:
        i < DEMO_SEED_TARGETS.missedCalls
          ? "Missed call, recovery workflow (simulated)"
          : "Answered by the receptionist (simulated)",
      actor: "demo_seed",
      at: new Date(now - i * 45 * 60_000).toISOString(),
    });
  }

  try {
    const { engine } = await ensureMissedCallReady();
    for (let i = 0; i < DEMO_SEED_TARGETS.missedCalls; i += 1) {
      const c = DEMO_CUSTOMERS[i]!;
      await engine.handleCallEvent({
        clientAccountId: clientId,
        callerE164: c.phone,
        answered: false,
        abandoned: true,
        calledAt: new Date(now - (i + 1) * 90 * 60_000),
      });
    }
  } catch {
    // Engine may be unavailable without full Module A config — timeline still seeded.
  }

  return { ...DEMO_SEED_TARGETS };
}

export async function deleteDemoBusiness(
  organizationId: string,
): Promise<void> {
  const saas = getSaasStore();
  const org = await saas.getOrganization(organizationId);
  if (!org || org.accountType !== "demo") {
    throw new Error("Demo business not found");
  }
  await wipeOrgScopedDemoData(organizationId);
  await purgeBusinessVoice(organizationId);
  const deleted = await saas.deleteOrganization(organizationId);
  if (!deleted) throw new Error("Failed to delete demo business");
}
