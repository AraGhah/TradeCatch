/**
 * Owner/admin self-serve editing of an already-linked organization's Module A
 * (SMS receptionist) client record — business details, hours, and technician
 * roster. Mirrors the receptionist profile service's split: the number
 * assignment and initial link stay with ops (see
 * /api/missed-call/ops/link-organization), the content an organization
 * manages day to day is self-serve here.
 */

import { z } from "zod";
import type { ClientAccount, TechnicianRosterEntry } from "./types";
import { validateClientConfig } from "./client-config";

export type ServiceResult = { status: number; body: Record<string, unknown> };

const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const HH_MM_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const technicianInputSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().regex(E164_PHONE, "must be an E.164 phone number"),
    role: z.enum(["primary", "backup", "owner"]),
    active: z.boolean(),
  })
  .strict();

export const smsReceptionistSettingsSchema = z
  .object({
    contractorDisplayName: z.string().trim().min(1).max(160),
    timezone: z.string().trim().min(1),
    businessHours: z.object({
      start: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
      end: z.string().regex(HH_MM_TIME, "must use 24-hour HH:MM"),
      days: z.array(z.number().int().min(0).max(6)).min(1),
    }),
    technicianRoster: z.array(technicianInputSchema).min(1).max(20),
    humanReviewPhone: z
      .string()
      .trim()
      .regex(E164_PHONE, "must be an E.164 phone number")
      .optional(),
  })
  .strict();

export type SmsReceptionistSettingsInput = z.infer<
  typeof smsReceptionistSettingsSchema
>;

export type OwnerSaveSmsDeps = {
  getClient(clientAccountId: string): Promise<ClientAccount | null>;
  saveClient(client: ClientAccount): Promise<void>;
};

let rosterIdCounter = 0;

function assignTechnicianIds(
  roster: SmsReceptionistSettingsInput["technicianRoster"],
  existing: readonly TechnicianRosterEntry[],
): TechnicianRosterEntry[] {
  const existingIds = new Set(existing.map((t) => t.id));
  const usedIds = new Set<string>();
  return roster.map((t) => {
    let id = t.id && existingIds.has(t.id) ? t.id : undefined;
    while (!id || usedIds.has(id)) {
      id = `tech_${Date.now()}_${rosterIdCounter++}`;
    }
    usedIds.add(id);
    return { id, name: t.name, phone: t.phone, role: t.role, active: t.active };
  });
}

/**
 * Owner/admin saves business details, hours, and technician roster for the
 * organization's already-linked Module A client. Never accepts or changes
 * `smsFromNumber` — the receiving number is ops-assigned, exactly like the
 * voice receptionist's number + activation (see profile-service.ts).
 */
export async function saveSmsReceptionistSettings(
  deps: OwnerSaveSmsDeps,
  input: {
    organization: { id: string; missedCallClientId: string | null };
    role: "owner" | "admin" | "member" | "viewer";
    body: unknown;
  },
): Promise<ServiceResult> {
  if (input.role !== "owner" && input.role !== "admin") {
    return {
      status: 403,
      body: {
        error: "Only an owner or admin can change the SMS receptionist.",
      },
    };
  }

  const parsed = smsReceptionistSettingsSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Invalid settings.",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
    };
  }

  const client = input.organization.missedCallClientId
    ? await deps.getClient(input.organization.missedCallClientId)
    : null;
  if (!client) {
    return {
      status: 409,
      body: {
        error:
          "Your SMS receptionist number has not been assigned yet. Contact support to finish setup.",
      },
    };
  }

  const roster = assignTechnicianIds(
    parsed.data.technicianRoster,
    client.technicianRoster,
  );
  const primary =
    roster.find((t) => t.role === "primary" && t.active) ??
    roster.find((t) => t.role === "primary");
  if (!primary) {
    return {
      status: 400,
      body: { error: "At least one primary technician is required." },
    };
  }
  const backupTechnicianIds = roster
    .filter((t) => t.role === "backup")
    .map((t) => t.id);
  const ownerTechnicianId = roster.find((t) => t.role === "owner")?.id;
  const rosterIds = new Set(roster.map((t) => t.id));

  const updated: ClientAccount = {
    ...client,
    name: parsed.data.contractorDisplayName,
    contractorDisplayName: parsed.data.contractorDisplayName,
    timezone: parsed.data.timezone,
    businessHours: parsed.data.businessHours,
    technicianRoster: roster,
    onCallTechnicians: roster.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      active: t.active,
    })),
    mainTechnicianId: primary.id,
    backupTechnicianIds,
    ownerTechnicianId,
    humanReviewPhone: parsed.data.humanReviewPhone ?? client.humanReviewPhone,
    // Re-point any schedule slot whose technician was removed, rather than
    // leaving a dangling reference that would fail validation obscurely.
    onCallSchedule: client.onCallSchedule.map((slot) =>
      rosterIds.has(slot.technicianId)
        ? slot
        : { ...slot, technicianId: primary.id },
    ),
  };

  const check = validateClientConfig(updated);
  if (!check.ok) {
    return {
      status: 400,
      body: { error: "Invalid settings.", issues: check.errors },
    };
  }

  await deps.saveClient(updated);
  return {
    status: 200,
    body: {
      ok: true,
      contractorDisplayName: updated.contractorDisplayName,
      timezone: updated.timezone,
      businessHours: updated.businessHours,
      technicianRoster: updated.technicianRoster,
      humanReviewPhone: updated.humanReviewPhone ?? null,
    },
  };
}
