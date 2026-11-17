import { z } from "zod";

/**
 * A business's privacy choices. Each one changes what TradeCatch actually does
 * (see docs/privacy-settings.md for where each is enforced); a setting that
 * would change nothing is not offered.
 */
export const RETENTION_OPTIONS = [30, 90, 180] as const;
export type RetentionDays = (typeof RETENTION_OPTIONS)[number];

export type PrivacySettings = {
  organizationId: string;
  /** Voicemail audio may be recorded (the caller hears a notice first and can hang up). */
  callRecordingEnabled: boolean;
  /** Receptionist call transcripts are kept after the call is summarized. */
  saveCallTranscripts: boolean;
  /** Text-message wording is kept after delivery has settled. */
  saveSmsHistory: boolean;
  /**
   * Days call and message content is kept. null = the standard platform
   * retention that applied before this setting existed (businesses created
   * before the setting keep it until the owner picks a value).
   */
  customerDataRetentionDays: RetentionDays | null;
  /** Usage analytics may run inside this business's dashboard. */
  analyticsEnabled: boolean;
  /** 0 = never saved (defaults); increases by one on every confirmed save. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type PrivacyValues = Omit<
  PrivacySettings,
  "organizationId" | "version" | "updatedAt" | "updatedBy"
>;

export const PRIVACY_FIELDS = [
  "callRecordingEnabled",
  "saveCallTranscripts",
  "saveSmsHistory",
  "customerDataRetentionDays",
  "analyticsEnabled",
] as const satisfies readonly (keyof PrivacyValues)[];

/**
 * Defaults for a business that has never saved privacy settings (created after
 * migration 040): nothing optional is recorded, shared or measured until the
 * owner turns it on. Transcripts stay on because the call history and
 * summaries the owner relies on are built from them.
 */
export const NEW_BUSINESS_DEFAULTS: PrivacyValues = {
  callRecordingEnabled: false,
  saveCallTranscripts: true,
  saveSmsHistory: true,
  customerDataRetentionDays: 90,
  analyticsEnabled: false,
};

export function defaultPrivacySettings(organizationId: string): PrivacySettings {
  return {
    organizationId,
    ...NEW_BUSINESS_DEFAULTS,
    version: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

/** A save names only the settings it changes; the rest keep their stored value. */
export const privacyPatchSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    callRecordingEnabled: z.boolean().optional(),
    saveCallTranscripts: z.boolean().optional(),
    saveSmsHistory: z.boolean().optional(),
    customerDataRetentionDays: z
      .union([z.literal(30), z.literal(90), z.literal(180)])
      .optional(),
    analyticsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => PRIVACY_FIELDS.some((field) => value[field] !== undefined),
    { message: "Nothing to save." },
  );

export type PrivacyPatch = Partial<
  Omit<PrivacyValues, "customerDataRetentionDays"> & {
    customerDataRetentionDays: RetentionDays;
  }
>;

export function patchFrom(input: z.infer<typeof privacyPatchSchema>): PrivacyPatch {
  const patch: PrivacyPatch = {};
  for (const field of PRIVACY_FIELDS) {
    const value = input[field];
    if (value !== undefined) Object.assign(patch, { [field]: value });
  }
  return patch;
}

/** "field:old→new" pairs for the audit log; values only, never customer data. */
export function describeChanges(before: PrivacySettings, after: PrivacySettings): string {
  return PRIVACY_FIELDS.filter((field) => before[field] !== after[field])
    .map((field) => `${field}:${String(before[field])}→${String(after[field])}`)
    .join(", ");
}

export function isRetentionDays(value: unknown): value is RetentionDays {
  return RETENTION_OPTIONS.includes(value as RetentionDays);
}
