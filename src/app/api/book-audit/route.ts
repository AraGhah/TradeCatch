import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bookAuditSchema } from "@/lib/validation/book-audit";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendBookAuditEmails } from "@/lib/email";
import { forwardLeadToCrm } from "@/lib/leads";
import { reportError } from "@/lib/errors";
import { createMemoryStore } from "@/lib/store";
import {
  isUpstashConfigured,
  upstashClaimIdempotencyKey,
} from "@/lib/upstash";
import {
  claimBookAuditDelivery,
  persistBookAuditLead,
  releaseBookAuditDeliveryClaim,
  updateBookAuditDelivery,
} from "@/lib/book-audit-leads";
import {
  getProductionConfigErrors,
  isDurableMissedCallStoreConfigured,
  isE2eHarness,
  isProductionRuntime,
} from "@/lib/config";

export const dynamic = "force-dynamic";

// Duplicate-submission guard (per-instance). When Upstash is configured,
// claims also go through Redis so multi-instance deploys share the window.
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
  const unknownIp = ip === "unknown" || ip.startsWith("unknown:");

  const { allowed } = await rateLimitAsync({
    key: `book-audit:${ip}`,
    limit: unknownIp ? 2 : 5,
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
    consentWording: CANONICAL_CONSENT_WORDING[clientPayload.preferredLanguage],
    consentSource: "book-audit",
  };

  if (payload.companyWebsite) {
    console.warn("[book-audit] honeypot triggered", { ip });
    return NextResponse.json({ ok: true });
  }

  // Verify Turnstile before any idempotency side effects so concurrent
  // unverified requests cannot burn the duplicate key.
  const turnstileResult = await verifyTurnstileToken(
    payload.turnstileToken,
    ip,
    "book-audit",
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

  const now = Date.now();
  if (isUpstashConfigured()) {
    try {
      const claimed = await upstashClaimIdempotencyKey({
        key: `book-audit:${idempotencyKey}`,
        ttlMs: IDEMPOTENCY_WINDOW_MS,
      });
      if (!claimed) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
    } catch (err) {
      console.error(
        "[book-audit] Upstash idempotency failed; using memory",
        err,
      );
    }
  }

  seenIdempotencyKeys.prune(IDEMPOTENCY_WINDOW_MS, now);
  if (seenIdempotencyKeys.has(idempotencyKey)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Mark idempotency only after Turnstile passes; clear on total delivery failure.
  seenIdempotencyKeys.set(idempotencyKey, now);

  const durableConfigured = isDurableMissedCallStoreConfigured();
  let persisted:
    | {
        id: string;
        duplicate: boolean;
        emailSent: boolean;
        crmForwarded: boolean;
      }
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

  // Fully delivered on a prior attempt — clean duplicate response.
  if (persisted?.duplicate && persisted.emailSent && persisted.crmForwarded) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let sent = false;
  let forwarded = false;

  if (persisted?.id && durableConfigured) {
    // Only one concurrent worker may attempt undelivered channels.
    const claim = await claimBookAuditDelivery(persisted.id);
    if (!claim) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const needEmail = !claim.emailSent;
    const needCrm = !claim.crmForwarded;
    const results = await Promise.all([
      needEmail
        ? sendBookAuditEmails(payload)
        : Promise.resolve({ sent: true }),
      needCrm
        ? forwardLeadToCrm(payload)
        : Promise.resolve({ forwarded: true }),
    ]);
    sent = results[0].sent;
    forwarded = results[1].forwarded;
    try {
      await updateBookAuditDelivery(persisted.id, {
        emailSent: sent,
        crmForwarded: forwarded,
      });
    } catch (err) {
      await reportError(
        err instanceof Error
          ? err
          : new Error("book-audit delivery status update failed"),
        { ip, trade: payload.trade, leadId: persisted.id },
      );
    }
    if (!sent || !forwarded) {
      await releaseBookAuditDeliveryClaim(persisted.id);
    }
  } else {
    const results = await Promise.all([
      sendBookAuditEmails(payload),
      forwardLeadToCrm(payload),
    ]);
    sent = results[0].sent;
    forwarded = results[1].forwarded;
  }

  // Require at least one delivery channel in production — including when the
  // row was persisted first. A DB-only lead with nobody notified is a loss.
  const requireDelivery = isProductionRuntime() && !isE2eHarness();
  if (requireDelivery && !sent && !forwarded) {
    seenIdempotencyKeys.delete(idempotencyKey);
    await reportError(new Error("book-audit delivery failed (email + CRM)"), {
      ip,
      trade: payload.trade,
      persisted: Boolean(persisted),
    });
    return jsonError(
      "We couldn't deliver your request. Please try again or call us.",
      503,
    );
  }

  if (isProductionRuntime() && !isE2eHarness() && !sent) {
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
    ...(persisted?.duplicate ? { duplicate: true } : {}),
  });
}
