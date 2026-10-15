/**
 * Task 3 — AI Receptionist management: overview payloads, partial settings
 * updates (knowledge / routing / transfer / appointments), and status.
 */

import type { ClientAccount } from "@/product/missed-call/types";
import type { Organization } from "@/product/saas/types";
import { DEFAULT_VOICES } from "./config";
import {
  appointmentSettingsSchema,
  composeBusinessFacts,
  defaultProfileSettings,
  knowledgeSchema,
  profileSettingsSchema,
  transferSettingsSchema,
  validateProfile,
  type AppointmentSettings,
  type KnowledgeSettings,
  type ProfileSettings,
  type ReceptionistProfile,
  type TransferSettings,
} from "./profile";
import type { ProfileStore } from "./profile-store";
import type { CallSession, CallHandlingMode } from "./types";
import { z } from "zod";

export type ReceptionistStatus = "active" | "inactive" | "error";

export type AiReceptionistOverview = {
  status: ReceptionistStatus;
  statusDetail?: string;
  receptionistName: string | null;
  phoneNumberE164: string | null;
  language: "en" | "fr" | "bilingual";
  voice: { fr: string; en: string };
  businessName: string;
  organizationId: string;
  activated: boolean;
  callHandlingMode: CallHandlingMode;
  /** Saved config vs live phone connection (Task 4). */
  operationalConnection: "not_connected" | "configured" | "error";
  callsHandled: number;
  appointmentsBooked: number;
  transfers: number;
  lastActivityAt: string | null;
  settings: ProfileSettings;
  updatedAt: string | null;
  integrationError?: string;
};

export function languageLabel(
  languages: ("fr" | "en")[],
): "en" | "fr" | "bilingual" {
  if (languages.length >= 2) return "bilingual";
  return languages[0] === "en" ? "en" : "fr";
}

export function buildOverview(input: {
  organization: Organization;
  profile: ReceptionistProfile | null;
  client: ClientAccount | null;
  calls: CallSession[];
  answering: boolean;
  integrationError?: string;
}): AiReceptionistOverview {
  const settings = input.profile?.settings ?? defaultProfileSettings();
  const activated = input.profile?.activated ?? false;
  let status: ReceptionistStatus = "inactive";
  let statusDetail: string | undefined;
  if (input.integrationError) {
    status = "error";
    statusDetail = input.integrationError;
  } else if (activated && input.answering) {
    status = "active";
  } else if (activated && !input.answering) {
    status = "error";
    statusDetail =
      "Activated but not answering — check call-handling mode, hours, or phone assignment.";
  }

  const completed = input.calls.filter((c) => c.status === "completed" || c.finalizedAt);
  const appointmentsBooked = completed.filter(
    (c) => c.outcome === "appointment_requested",
  ).length;
  const transfers = completed.filter(
    (c) =>
      c.outcome === "transferred" || c.outcome === "emergency_transferred",
  ).length;
  const last = input.calls
    .map((c) => c.endedAt || c.updatedAt || c.startedAt)
    .sort()
    .at(-1);

  const phone =
    input.profile?.phoneNumberE164 ||
    input.organization.phoneE164 ||
    input.client?.smsFromNumber ||
    null;

  return {
    status,
    statusDetail,
    receptionistName: settings.receptionistName ?? null,
    phoneNumberE164: phone,
    language: languageLabel(settings.languages),
    voice: {
      fr: settings.voiceFr ?? DEFAULT_VOICES.fr,
      en: settings.voiceEn ?? DEFAULT_VOICES.en,
    },
    businessName:
      settings.knowledge.companyName ||
      input.client?.contractorDisplayName ||
      input.organization.name,
    organizationId: input.organization.id,
    activated,
    callHandlingMode: settings.callHandlingMode,
    operationalConnection: input.integrationError
      ? "error"
      : activated && phone
        ? "configured"
        : "not_connected",
    callsHandled: completed.length,
    appointmentsBooked,
    transfers,
    lastActivityAt: last ?? null,
    settings,
    updatedAt: input.profile?.updatedAt ?? null,
    integrationError: input.integrationError,
  };
}

const patchSchema = profileSettingsSchema.partial();

export async function patchAiReceptionistSettings(
  profiles: ProfileStore,
  input: {
    organizationId: string;
    client: ClientAccount;
    role: "owner" | "admin" | "member";
    userEmail: string;
    body: unknown;
    env?: NodeJS.ProcessEnv;
  },
): Promise<
  | { ok: true; profile: ReceptionistProfile }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    }
> {
  if (input.role !== "owner" && input.role !== "admin") {
    return {
      ok: false,
      status: 403,
      body: { error: "Only an owner or admin can change the receptionist." },
    };
  }
  const parsed = patchSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
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

  const existing = await profiles.getProfile(input.organizationId);
  const base = existing?.settings ?? defaultProfileSettings();
  const merged = profileSettingsSchema.parse({
    ...base,
    ...parsed.data,
    knowledge: {
      ...base.knowledge,
      ...(parsed.data.knowledge ?? {}),
    },
    transferSettings: {
      ...base.transferSettings,
      ...(parsed.data.transferSettings ?? {}),
    },
    appointmentSettings: {
      ...base.appointmentSettings,
      ...(parsed.data.appointmentSettings ?? {}),
    },
    collectFields: {
      ...base.collectFields,
      ...(parsed.data.collectFields ?? {}),
    },
  });

  const checked = validateProfile(
    {
      organizationId: input.organizationId,
      phoneNumberE164: existing?.phoneNumberE164,
      activated: existing?.activated ?? false,
      settings: merged,
      updatedAt: new Date().toISOString(),
    },
    { client: input.client, env: input.env },
  );
  if (!checked.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: "Invalid settings.", issues: checked.issues },
    };
  }

  const profile = await profiles.saveSettings(
    input.organizationId,
    merged,
    input.userEmail,
  );
  return { ok: true, profile };
}

export async function putKnowledge(
  profiles: ProfileStore,
  input: {
    organizationId: string;
    client: ClientAccount;
    role: "owner" | "admin" | "member";
    userEmail: string;
    knowledge: unknown;
    faqs?: unknown;
    env?: NodeJS.ProcessEnv;
  },
) {
  const knowledge = knowledgeSchema.safeParse(input.knowledge ?? {});
  if (!knowledge.success) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "Invalid knowledge.", issues: knowledge.error.issues },
    };
  }
  const faqsParsed =
    input.faqs === undefined
      ? undefined
      : z
          .array(
            z.object({
              question: z.string().trim().max(200).optional(),
              keywords: z.array(z.string().trim().min(2).max(40)).max(8).default([]),
              answerFr: z.string().trim().min(1).max(500),
              answerEn: z.string().trim().min(1).max(500),
            }),
          )
          .max(20)
          .safeParse(input.faqs);
  if (faqsParsed && !faqsParsed.success) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "Invalid FAQs.", issues: faqsParsed.error.issues },
    };
  }

  return patchAiReceptionistSettings(profiles, {
    organizationId: input.organizationId,
    client: input.client,
    role: input.role,
    userEmail: input.userEmail,
    env: input.env,
    body: {
      knowledge: knowledge.data,
      ...(faqsParsed?.success ? { faqs: faqsParsed.data } : {}),
      businessFacts: composeBusinessFacts(knowledge.data),
    },
  });
}

export async function putCallRouting(
  profiles: ProfileStore,
  input: {
    organizationId: string;
    client: ClientAccount;
    role: "owner" | "admin" | "member";
    userEmail: string;
    callHandlingMode: unknown;
    businessHours?: unknown;
    env?: NodeJS.ProcessEnv;
  },
) {
  const mode = z
    .enum(["always", "business_hours", "after_hours", "overflow", "disabled"])
    .safeParse(input.callHandlingMode);
  if (!mode.success) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "Invalid callHandlingMode." },
    };
  }
  return patchAiReceptionistSettings(profiles, {
    organizationId: input.organizationId,
    client: input.client,
    role: input.role,
    userEmail: input.userEmail,
    env: input.env,
    body: {
      callHandlingMode: mode.data,
      ...(input.businessHours
        ? { businessHours: input.businessHours }
        : {}),
    },
  });
}

export async function putTransferSettings(
  profiles: ProfileStore,
  input: {
    organizationId: string;
    client: ClientAccount;
    role: "owner" | "admin" | "member";
    userEmail: string;
    transferSettings: unknown;
    emergencyTransferE164?: unknown;
    env?: NodeJS.ProcessEnv;
  },
) {
  const parsed = transferSettingsSchema.safeParse(input.transferSettings ?? {});
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "Invalid transfer settings.", issues: parsed.error.issues },
    };
  }
  return patchAiReceptionistSettings(profiles, {
    organizationId: input.organizationId,
    client: input.client,
    role: input.role,
    userEmail: input.userEmail,
    env: input.env,
    body: {
      transferSettings: parsed.data,
      fallbackTransferE164: parsed.data.primaryTransferE164,
      ...(typeof input.emergencyTransferE164 === "string"
        ? { emergencyTransferE164: input.emergencyTransferE164 }
        : {}),
    },
  });
}

export async function putAppointmentSettings(
  profiles: ProfileStore,
  input: {
    organizationId: string;
    client: ClientAccount;
    role: "owner" | "admin" | "member";
    userEmail: string;
    appointmentSettings: unknown;
    env?: NodeJS.ProcessEnv;
  },
) {
  const parsed = appointmentSettingsSchema.safeParse(
    input.appointmentSettings ?? {},
  );
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "Invalid appointment settings.",
        issues: parsed.error.issues,
      },
    };
  }
  return patchAiReceptionistSettings(profiles, {
    organizationId: input.organizationId,
    client: input.client,
    role: input.role,
    userEmail: input.userEmail,
    env: input.env,
    body: { appointmentSettings: parsed.data },
  });
}

export type { KnowledgeSettings, TransferSettings, AppointmentSettings };
