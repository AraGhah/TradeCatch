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
    .enum(["gather", "conversation_relay"])
    .default("gather"),
  humanTransferE164: safeOptionalCanadian,
  backupTransferE164: safeOptionalCanadian,
  humanRingTimeoutSeconds: z.number().int().min(10).max(60).default(25),
  callRecordingEnabled: z.boolean().default(false),
  forwardingInstructionsAck: z.boolean().default(false),
  ringHumanOnOverflow: z.boolean().default(true),
});

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
        "Profile activated — inbound webhooks resolve this number to the business.";
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
