import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bookAuditSchema } from "@/lib/validation/book-audit";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendBookAuditEmails } from "@/lib/email";
import { createMemoryStore } from "@/lib/store";
import {
  getProductionConfigErrors,
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

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const configErrors = getProductionConfigErrors();
  if (configErrors.length > 0) {
    console.error("[book-audit] refusing request — production misconfigured:", configErrors);
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

  const { idempotencyKey, ...payload } = parsed.data;

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

  // In production the config guard above already ensures Turnstile is set.
  // In development, unconfigured Turnstile still skips (with a warning).
  if (turnstileResult.configured && !turnstileResult.success) {
    return jsonError("Bot verification failed. Please try again.", 400);
  }
  if (!turnstileResult.configured && isProductionRuntime()) {
    return jsonError(
      "This service is temporarily unavailable. Please try again later.",
      503,
    );
  }

  seenIdempotencyKeys.set(idempotencyKey, now);

  const { sent } = await sendBookAuditEmails(payload);

  if (isProductionRuntime() && !sent) {
    console.error("[book-audit] email send failed in production", {
      ip,
      trade: payload.trade,
    });
    // Still accept the lead so the visitor isn't blocked if Resend blips —
    // but log loudly so ops notices. Config absence is already blocked above.
  }

  console.info("[book-audit] submission accepted", {
    ip,
    trade: payload.trade,
    preferredLanguage: payload.preferredLanguage,
    emailSent: sent,
  });

  return NextResponse.json({ ok: true, emailSent: sent });
}
