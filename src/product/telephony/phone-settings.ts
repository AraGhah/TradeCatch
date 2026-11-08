import { z } from "zod";
import type { PhoneSettings, PhoneSettingsView } from "./types";

const CANADIAN_AREA_CODES = new Set(
  (
    "204 226 236 249 250 263 289 306 343 354 365 367 368 382 403 416 418 428 431 437 438 450 468 474 " +
    "506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 " +
    "867 873 879 902 905"
  ).split(" "),
);

function isCanadianE164(e164: string): boolean {
  const m = /^\+1(\d{3})([2-9]\d{2})\d{4}$/.exec(e164.trim());
  if (!m) return false;
  const [, area, exchange] = m;
  if (!CANADIAN_AREA_CODES.has(area!)) return false;
  return !exchange!.endsWith("11");
}

const optionalE164 = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/),
  ])
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const safeOptionalCanadian = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .refine(isCanadianE164, "must be a Canadian E.164 number"),
  ])
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/**
 * A caller number as the owner typed it ("514 555-0142", "+1 (514) …") →
 * E.164. North American 10/11-digit numbers get +1; anything already starting
 * with + keeps its country code. Returns null when it cannot be a phone number.
 */
export function normalizeContactE164(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

const contactE164 = z
  .string()
  .trim()
  .max(32)
  .transform((v, ctx) => {
    const e164 = normalizeContactE164(v);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "must be a phone number" });
      return z.NEVER;
    }
    return e164;
  });

const personalContactSchema = z.object({
  e164: contactE164,
  label: z.string().trim().max(60).optional(),
});

const isoTimestamp = z.string().datetime().optional();

/** Spoken to excluded callers; plain text, short, no markup. */
const personalMessageText = z
  .string()
  .trim()
  .max(300)
  .regex(/^[^<>{}]*$/, "must be plain text")
  .optional();

/**
 * The AI Call Handling fields. Every one is optional with no default, so a
 * profile stored before this feature parses to exactly what it was.
 */
export const aiCallHandlingFields = {
  aiCallMode: z.enum(["missed_calls_only", "ai_answers_all"]).optional(),
  routingMethod: z.enum(["tradecatch_number", "carrier_forwarding"]).optional(),
  contractorPhoneE164: safeOptionalCanadian,
  personalContacts: z
    .array(personalContactSchema)
    .max(50)
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((c) => !seen.has(c.e164) && Boolean(seen.add(c.e164)));
    })
    .optional(),
  personalCallPolicy: z.enum(["message", "transfer", "end"]).optional(),
  personalCallMessage: z
    .object({ fr: personalMessageText, en: personalMessageText })
    .optional(),
  personalCallTransferE164: safeOptionalCanadian,
  unknownCallerPolicy: z.enum(["ai", "message"]).optional(),
  modeUpdatedAt: isoTimestamp,
  routingTestStartedAt: isoTimestamp,
  /** Last read-only check of where Twilio sends the TradeCatch number. */
  numberRoutingCheck: z
    .object({
      result: z.enum(["webhook", "sip_trunk", "elsewhere", "unknown"]),
      checkedAt: z.string().datetime(),
    })
    .optional(),
  routingVerification: z
    .object({
      mode: z.enum(["missed_calls_only", "ai_answers_all"]),
      method: z.enum(["tradecatch_number", "carrier_forwarding"]),
      path: z.enum([
        "rang_contractor_first",
        "ai_answered_webhook",
        "ai_answered_livekit_direct",
        "forwarded_by_carrier",
      ]),
      verifiedAt: z.string().datetime(),
    })
    .optional(),
};

export const phoneSettingsSchema = z.object({
  businessPhoneE164: optionalE164,
  tradecatchNumberE164: optionalE164,
  connectionStatus: z
    .enum(["connected", "disconnected", "error"])
    .default("disconnected"),
  connectionDetail: z.string().trim().max(400).optional(),
  aiEnabled: z.boolean().default(true),
  inboundStrategy: z.enum(["ai_first", "human_first"]).default("ai_first"),
  voiceEngine: z
    .enum(["gather", "conversation_relay", "livekit"])
    .default("gather"),
  humanTransferE164: safeOptionalCanadian,
  backupTransferE164: safeOptionalCanadian,
  humanRingTimeoutSeconds: z.number().int().min(10).max(60).default(25),
  callRecordingEnabled: z.boolean().default(false),
  forwardingInstructionsAck: z.boolean().default(false),
  ringHumanOnOverflow: z.boolean().default(true),
  ...aiCallHandlingFields,
});

/** Fields only the AI Call Handling endpoint writes; other saves keep them. */
export const AI_CALL_HANDLING_KEYS = Object.keys(
  aiCallHandlingFields,
) as (keyof typeof aiCallHandlingFields)[];

export type PhoneSettingsInput = z.infer<typeof phoneSettingsSchema>;

export function defaultPhoneSettings(): PhoneSettings {
  return phoneSettingsSchema.parse({});
}

export function parsePhoneSettings(raw: unknown): PhoneSettings {
  const parsed = phoneSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultPhoneSettings();
}

export function publicWebhookBase(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const base = env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim();
  return base ? base.replace(/\/$/, "") : null;
}

export function buildPhoneSettingsView(input: {
  organizationId: string;
  activated: boolean;
  profilePhoneE164?: string;
  callHandlingMode: string;
  defaultLanguage: "fr" | "en";
  businessHours?: { start: string; end: string; days: number[] };
  receptionistName?: string;
  phone: PhoneSettings;
  env?: NodeJS.ProcessEnv;
}): PhoneSettingsView {
  const base = publicWebhookBase(input.env);
  const tradecatch =
    input.phone.tradecatchNumberE164 || input.profilePhoneE164;
  let connectionStatus = input.phone.connectionStatus;
  let connectionDetail = input.phone.connectionDetail;
  if (input.activated && tradecatch) {
    if (connectionStatus === "disconnected") {
      connectionStatus = "connected";
      connectionDetail =
        connectionDetail ||
        "Profile activated. Incoming calls to this number reach the business.";
    }
  } else if (!tradecatch) {
    connectionStatus = "disconnected";
    connectionDetail =
      connectionDetail || "No TradeCatch number assigned yet.";
  }

  return {
    ...input.phone,
    tradecatchNumberE164: tradecatch,
    connectionStatus,
    connectionDetail,
    organizationId: input.organizationId,
    activated: input.activated,
    profilePhoneE164: input.profilePhoneE164,
    callHandlingMode: input.callHandlingMode,
    defaultLanguage: input.defaultLanguage,
    businessHours: input.businessHours,
    receptionistName: input.receptionistName,
    webhookVoiceUrl: base
      ? `${base}/api/webhooks/twilio/voice`
      : null,
    webhookStatusUrl: base
      ? `${base}/api/webhooks/twilio/status`
      : null,
    conversationRelayUrl: base
      ? `${base.replace(/^http/, "ws")}/api/voice/socket`
      : null,
  };
}
