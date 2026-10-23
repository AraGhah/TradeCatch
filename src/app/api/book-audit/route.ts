import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";
import { bookAuditSchema } from "@/lib/validation/book-audit";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { reportError } from "@/lib/errors";
import {
  persistBookAuditLead,
  type PersistedBookAuditLead,
} from "@/lib/book-audit-leads";
import {
  getProductionConfigErrors,
  isDurableMissedCallStoreConfigured,
  isLeadsWebhookConfigured,
  requiresProductionLeadProtection,
} from "@/lib/config";
import {
  getBookAuditNotificationStatus,
  processBookAuditNotifications,
} from "@/lib/book-audit-notifications";

export const dynamic = "force-dynamic";

const SAVE_ERROR =
  "We couldn't save your request. Please try again or call us.";

const requestSchema = bookAuditSchema.extend({
  idempotencyKey: z.string().uuid(),
});

const CANONICAL_CONSENT_WORDING = {
  en: "I agree to be contacted about this request by phone, email or text. Message and data rates may apply. I can opt out at any time.",
  fr: "J'accepte d'être contacté au sujet de cette demande par téléphone, courriel ou texto. Des frais de messagerie et de données peuvent s'appliquer. Je peux me désabonner en tout temps.",
} as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const configErrors = getProductionConfigErrors();
  if (configErrors.length > 0) {
    console.error(
      "[book-audit] refusing request — production misconfigured:",
      configErrors,
    );
    return jsonError(
      "This service is temporarily unavailable. Please try again later.",
      503,
    );
  }

  const ip = getClientIp(request);
  const unknownIp = ip === "unknown" || ip.startsWith("unknown:");

  const { allowed } = await rateLimitAsync({
    key: `book-audit:${ip}`,
    limit: unknownIp ? 2 : 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return jsonError("Too many requests. Please try again later.", 429);
  }

  const read = await readJsonBody(request, 32_768);
  if (!read.ok)
    return jsonError(
      read.status === 413 ? read.error : "Invalid request body.",
      read.status,
    );

  const parsed = requestSchema.safeParse(read.data);
  if (!parsed.success) {
    return jsonError("Invalid form data.", 400);
  }

  const { idempotencyKey, ...clientPayload } = parsed.data;
  const payload = {
    ...clientPayload,
    // Consent evidence must be controlled by the server, not supplied by a
    // client that can invent or alter the displayed legal wording.
    consentWording: CANONICAL_CONSENT_WORDING[clientPayload.preferredLanguage],
    consentSource: "book-audit",
  };

  if (payload.companyWebsite) {
    console.warn("[book-audit] honeypot triggered", { ip });
    return NextResponse.json({ ok: true });
  }

  // Do not consume a bot-verification token when storage is unavailable.
  // This guard is only a readiness check; persistence must still succeed below.
  if (
    !isDurableMissedCallStoreConfigured() ||
    !process.env.DATABASE_URL?.trim()
  ) {
    console.error("[book-audit] durable storage is not configured");
    return jsonError(SAVE_ERROR, 503);
  }

  // Verify Turnstile before persisting the lead.
  const turnstileResult = await verifyTurnstileToken(
    payload.turnstileToken,
    ip,
    "book-audit",
  );

  if (
    !turnstileResult.success &&
    (turnstileResult.configured || requiresProductionLeadProtection())
  ) {
    console.warn("[book-audit] Turnstile rejected", {
      ip,
      reason: turnstileResult.error,
    });
    return jsonError("Bot verification failed. Please try again.", 400);
  }

  let persisted: PersistedBookAuditLead | null;

  // Durable-first: write the lead before email/CRM so a later crash cannot
  // confirm success to the visitor while dropping the record.
  try {
    persisted = await persistBookAuditLead({
      idempotencyKey,
      payload,
      consent: {
        wording: payload.consentWording,
        source: payload.consentSource || "book-audit",
        at: new Date().toISOString(),
      },
      emailSent: false,
      crmForwarded: false,
    });
  } catch (err) {
    await reportError(
      err instanceof Error
        ? err
        : new Error("book-audit durable persist failed"),
      { ip, trade: payload.trade },
    );
    return jsonError(SAVE_ERROR, 503);
  }

  if (!persisted) {
    await reportError(new Error("book-audit durable persist returned null"), {
      ip,
      trade: payload.trade,
    });
    return jsonError(SAVE_ERROR, 503);
  }

  // The lead and its retry jobs have committed together. A delivery outage
  // cannot change that fact or depend on the visitor submitting again.
  let status = {
    emailSent: persisted.emailSent,
    customerEmailSent: false,
    crmForwarded: persisted.crmForwarded,
    nativeCrmSynced: persisted.nativeCrmSynced,
    externalCrmConfigured: isLeadsWebhookConfigured(),
    notificationsDelivered: false,
  };
  try {
    await processBookAuditNotifications({ leadId: persisted.id, limit: 3 });
    status = await getBookAuditNotificationStatus(persisted.id);
  } catch (err) {
    console.error("[book-audit] initial notification processing deferred", {
      leadId: persisted.id,
      error: err instanceof Error ? err.name : "UnknownError",
    });
  }

  console.info("[book-audit] lead saved", {
    leadId: persisted.id,
    notificationsDelivered: status.notificationsDelivered,
  });

  return NextResponse.json({
    ok: true,
    leadSaved: true,
    ...status,
    notificationsStatus: status.notificationsDelivered
      ? "delivered"
      : "pending",
    ...(persisted.duplicate ? { duplicate: true } : {}),
  });
}
