import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bookAuditSchema } from "@/lib/validation/book-audit";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendBookAuditEmails } from "@/lib/email";
import { forwardLeadToCrm } from "@/lib/leads";
import { reportError } from "@/lib/errors";
import { createMemoryStore } from "@/lib/store";
import { persistBookAuditLead } from "@/lib/book-audit-leads";
import {
  getProductionConfigErrors,
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isProductionRuntime,
} from "@/lib/config";

export const dynamic = "force-dynamic";

// Duplicate-submission guard. Uses the shared TimedStore abstraction so a
// Redis-backed implementation can replace createMemoryStore in one place.
const seenIdempotencyKeys = createMemoryStore();
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

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

  const { allowed } = rateLimit({
    key: `book-audit:${ip}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return jsonError("Too many requests. Please try again later.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid form data.", 400);
  }

  const { idempotencyKey, ...clientPayload } = parsed.data;
  const payload = {
    ...clientPayload,
    // Consent evidence must be controlled by the server, not supplied by a
    // client that can invent or alter the displayed legal wording.
    consentWording:
      CANONICAL_CONSENT_WORDING[clientPayload.preferredLanguage],
    consentSource: "book-audit",
  };

  if (payload.companyWebsite) {
    console.warn("[book-audit] honeypot triggered", { ip });
    return NextResponse.json({ ok: true });
  }

  const now = Date.now();
  seenIdempotencyKeys.prune(IDEMPOTENCY_WINDOW_MS, now);
  if (seenIdempotencyKeys.has(idempotencyKey)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const turnstileResult = await verifyTurnstileToken(
    payload.turnstileToken,
    ip,
  );

  if (turnstileResult.configured && !turnstileResult.success) {
    console.warn("[book-audit] Turnstile rejected", {
      ip,
      reason: turnstileResult.error,
    });
    return jsonError("Bot verification failed. Please try again.", 400);
  }
  if (!turnstileResult.configured && isProductionRuntime()) {
    if (!isE2eHarness()) {
      return jsonError(
        "This service is temporarily unavailable. Please try again later.",
        503,
      );
    }
  }

  // Mark idempotency only after Turnstile passes; clear on total delivery failure.
  seenIdempotencyKeys.set(idempotencyKey, now);

  const durableConfigured = isDurableMissedCallStoreConfigured();
  let persisted:
    | { id: string; duplicate: boolean }
    | null
    | undefined;

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
    seenIdempotencyKeys.delete(idempotencyKey);
    await reportError(
      err instanceof Error
        ? err
        : new Error("book-audit durable persist failed"),
      { ip, trade: payload.trade },
    );
    return jsonError(
      "We couldn't save your request. Please try again or call us.",
      503,
    );
  }

  if (durableConfigured && !persisted) {
    seenIdempotencyKeys.delete(idempotencyKey);
    await reportError(new Error("book-audit durable persist returned null"), {
      ip,
      trade: payload.trade,
    });
    return jsonError(
      "We couldn't save your request. Please try again or call us.",
      503,
    );
  }

  if (persisted?.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const [{ sent }, { forwarded }] = await Promise.all([
    sendBookAuditEmails(payload),
    forwardLeadToCrm(payload),
  ]);

  // In production, at least one delivery channel must succeed — unless the E2E
  // harness is active (no live Resend/CRM) or the lead is already durable.
  const requireDelivery =
    isProductionRuntime() &&
    !isE2eHarness() &&
    !persisted;
  if (requireDelivery && !sent && !forwarded) {
    seenIdempotencyKeys.delete(idempotencyKey);
    await reportError(new Error("book-audit delivery failed (email + CRM)"), {
      ip,
      trade: payload.trade,
    });
    return jsonError(
      "We couldn't save your request. Please try again or call us.",
      503,
    );
  }

  if (
    isProductionRuntime() &&
    !isE2eHarness() &&
    !sent
  ) {
    await reportError(new Error("book-audit email send failed"), {
      ip,
      trade: payload.trade,
      forwarded,
      persisted: Boolean(persisted),
    });
  }

  console.info("[book-audit] submission accepted", {
    ip,
    trade: payload.trade,
    preferredLanguage: payload.preferredLanguage,
    emailSent: sent,
    crmForwarded: forwarded,
    persisted: Boolean(persisted),
  });

  return NextResponse.json({
    ok: true,
    emailSent: sent,
    crmForwarded: forwarded,
  });
}
