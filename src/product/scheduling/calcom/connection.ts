import { z } from "zod";
import { orgHasFeature } from "@/product/saas/entitlements";
import type { Organization } from "@/product/saas/types";
import { decryptSecret, encryptSecret } from "../crypto";
import type { SchedulingService } from "../service";
import type { SchedulingStore } from "../store";
import {
  CALCOM_API_KEY_PATTERN,
  getMe,
  listEventTypes,
  type CalcomEventType,
  type CalcomFetch,
} from "./client";
import type {
  CalcomConnection,
  CalcomConnectionPublic,
  CalcomRoute,
} from "./types";

/**
 * Cal.com is switched on one business at a time, by the operator, after it
 * has been tried with that business's own account. It needs a plan that
 * includes appointments, an active non-demo account and the business's id on
 * the enrollment list. It is never a customer-editable flag.
 */
export function calcomPilotAllowed(
  org: Pick<
    Organization,
    "id" | "status" | "accountType" | "plan" | "features"
  > | null,
  enrolled = process.env.CALCOM_PILOT_ORG_IDS ?? "",
) {
  return Boolean(
    org &&
      org.status === "active" &&
      org.accountType !== "demo" &&
      orgHasFeature(org.plan, "APPOINTMENT_BOOKING") &&
      org.features.appointmentBooking &&
      enrolled
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .includes(org.id),
  );
}

export function calcomMultiCrew(org: Pick<Organization, "plan"> | null) {
  return Boolean(org && orgHasFeature(org.plan, "MULTI_CREW_CALENDARS"));
}

function sealingSecret(): string {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("AUTH_SECRET is required to protect calendar credentials.");
  }
  // Domain-separated, so a Google token blob can never open a Cal.com one.
  return `calcom-credential:${value}`;
}

export function sealCalcomKey(apiKey: string): string {
  return encryptSecret(apiKey, sealingSecret());
}

/** The API key, or null when the stored value cannot be opened. */
export function openCalcomKey(ciphertext: string | undefined): string | null {
  if (!ciphertext) return null;
  try {
    const key = decryptSecret(ciphertext, sealingSecret());
    return CALCOM_API_KEY_PATTERN.test(key) ? key : null;
  } catch {
    return null;
  }
}

export function publicConnection(
  row: CalcomConnection | null,
): CalcomConnectionPublic | null {
  if (!row) return null;
  const { credentialCiphertext, credentialKind, ...rest } = row;
  void credentialKind;
  return {
    ...rest,
    credential: credentialCiphertext ? "api_key" : "none",
  };
}

const routeSchema = z
  .object({
    eventTypeId: z.number().int().positive(),
    serviceId: z.string().min(1).max(128).optional(),
    technicianId: z.string().min(1).max(128).optional(),
  })
  .strict();

export const connectCalcomSchema = z
  .object({
    /** Required the first time; omit it later to keep the stored key. */
    apiKey: z.string().regex(CALCOM_API_KEY_PATTERN).optional(),
    defaultEventTypeId: z.number().int().positive(),
    routes: z.array(routeSchema).max(50).default([]),
    attendeeEmail: z.string().email().max(254).optional(),
  })
  .strict();

export type ConnectCalcomInput = z.infer<typeof connectCalcomSchema>;

export type ConnectProblem =
  | "api_key_required"
  | "unauthorized"
  | "unreachable"
  | "event_type_not_found"
  | "event_type_unbookable"
  | "unknown_service"
  | "unknown_technician"
  | "duplicate_route"
  | "specialists_not_included";

export type ConnectResult =
  | {
      ok: true;
      connection: CalcomConnectionPublic;
      warnings: { code: string; detail?: string }[];
    }
  | { ok: false; code: ConnectProblem; detail?: string };

export type CalcomConnectionDeps = {
  store: SchedulingStore;
  scheduling: Pick<SchedulingService, "setCalendarMode" | "listServices">;
  now?: () => Date;
  fetchImpl?: CalcomFetch;
  baseUrl?: string;
  /** Receptionist Plus: specialist calendars may be mapped. */
  multiCrew: boolean;
};

/**
 * Check a key and an event-type mapping against Cal.com and this business,
 * then store them and make Cal.com the calendar that decides availability.
 * Nothing is stored unless every check passes.
 */
export async function connectCalcom(
  deps: CalcomConnectionDeps,
  organizationId: string,
  input: ConnectCalcomInput,
): Promise<ConnectResult> {
  const existing = await deps.store.getCalcomConnection(organizationId);
  let apiKey = input.apiKey ?? null;
  if (!apiKey) {
    apiKey =
      existing && existing.status !== "disconnected"
        ? openCalcomKey(existing.credentialCiphertext)
        : null;
  }
  if (!apiKey) return { ok: false, code: "api_key_required" };

  const seen = new Set<string>();
  for (const route of input.routes) {
    const key = `${route.serviceId ?? ""}|${route.technicianId ?? ""}`;
    if (seen.has(key)) return { ok: false, code: "duplicate_route", detail: key };
    seen.add(key);
  }
  if (input.routes.some((route) => route.technicianId) && !deps.multiCrew) {
    return { ok: false, code: "specialists_not_included" };
  }

  // Every id must belong to this business: a mapping can never point at
  // another tenant's service or technician.
  const [services, technicians] = await Promise.all([
    deps.scheduling.listServices(organizationId),
    deps.store.listTechnicians(organizationId),
  ]);
  for (const route of input.routes) {
    if (route.serviceId && !services.some((row) => row.id === route.serviceId)) {
      return { ok: false, code: "unknown_service", detail: route.serviceId };
    }
    if (
      route.technicianId &&
      !technicians.some((row) => row.id === route.technicianId)
    ) {
      return {
        ok: false,
        code: "unknown_technician",
        detail: route.technicianId,
      };
    }
  }

  const auth = {
    apiKey,
    fetchImpl: deps.fetchImpl,
    baseUrl: deps.baseUrl,
  };
  const me = await getMe(auth);
  if (!me.ok) {
    return {
      ok: false,
      code:
        me.kind === "rejected" && me.code === "unauthorized"
          ? "unauthorized"
          : "unreachable",
    };
  }
  const types = await listEventTypes(auth);
  if (!types.ok) {
    return {
      ok: false,
      code:
        types.kind === "rejected" && types.code === "unauthorized"
          ? "unauthorized"
          : "unreachable",
    };
  }
  const byId = new Map<number, CalcomEventType>(
    types.data.map((row) => [row.id, row]),
  );
  const used = new Set<number>([
    input.defaultEventTypeId,
    ...input.routes.map((route) => route.eventTypeId),
  ]);
  const warnings: { code: string; detail?: string }[] = [];
  for (const id of used) {
    const type = byId.get(id);
    if (!type) {
      return { ok: false, code: "event_type_not_found", detail: String(id) };
    }
    if (type.blockers.length > 0) {
      // Confirmation-required, seated, recurring and instant event types
      // cannot be booked unattended and then called "confirmed".
      return {
        ok: false,
        code: "event_type_unbookable",
        detail: `${id}:${type.blockers.join(",")}`,
      };
    }
  }
  // A length that differs from the TradeCatch service blocks the wrong amount
  // of time on one side. It is allowed, but the owner is told.
  for (const route of input.routes) {
    const service = services.find((row) => row.id === route.serviceId);
    const length = byId.get(route.eventTypeId)?.lengthInMinutes;
    if (service && length && length !== service.durationMinutes) {
      warnings.push({
        code: "length_mismatch",
        detail: `${service.id}:${service.durationMinutes}!=${length}`,
      });
    }
  }
  const attendeeEmail = input.attendeeEmail ?? existing?.attendeeEmail;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const row: CalcomConnection = {
    organizationId,
    status: "connected",
    credentialKind: "api_key",
    credentialCiphertext: input.apiKey
      ? sealCalcomKey(input.apiKey)
      : existing?.credentialCiphertext,
    accountEmail: me.data.email,
    accountUsername: me.data.username,
    accountTimeZone: me.data.timeZone,
    defaultEventTypeId: input.defaultEventTypeId,
    routes: input.routes as CalcomRoute[],
    attendeeEmail,
    lastVerifiedAt: now,
    updatedAt: now,
  };
  await deps.store.saveCalcomConnection(row);
  await deps.scheduling.setCalendarMode(organizationId, "calcom");
  return {
    ok: true,
    connection: publicConnection(row) as CalcomConnectionPublic,
    warnings,
  };
}

/**
 * Remove the credential and stop using Cal.com. Bookings already made stay in
 * the contractor's Cal.com account; cancelling one from TradeCatch needs the
 * connection again, so that fails closed rather than pretending to succeed.
 */
export async function disconnectCalcom(
  deps: Pick<CalcomConnectionDeps, "store" | "scheduling" | "now">,
  organizationId: string,
): Promise<void> {
  const existing = await deps.store.getCalcomConnection(organizationId);
  if (existing) {
    await deps.store.saveCalcomConnection({
      ...existing,
      status: "disconnected",
      credentialCiphertext: undefined,
      lastError: undefined,
      updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    });
  }
  await deps.scheduling.setCalendarMode(organizationId, "simulated");
}
