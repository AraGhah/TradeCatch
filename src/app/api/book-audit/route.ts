import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bookAuditSchema } from "@/lib/validation/book-audit";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendBookAuditEmails } from "@/lib/email";

export const dynamic = "force-dynamic";

// Duplicate-submission guard: tracks idempotency keys seen in the last
// window so a double-click or retry doesn't send two emails. Same
// single-process caveat as rate-limit.ts — fine for a single instance,
// needs a shared store for multi-instance production deployments.
const seenIdempotencyKeys = new Map<string, number>();
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

const requestSchema = bookAuditSchema.extend({
  idempotencyKey: z.string().uuid(),
});

function jsonError(message: string, status: number) {
  // Redacted, generic client-facing errors — no stack traces or internals.
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
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

  // Honeypot: real visitors never fill this hidden field.
  if (payload.companyWebsite) {
    console.warn("[book-audit] honeypot triggered", { ip });
    // Return a success-shaped response so bots don't learn the honeypot exists.
    return NextResponse.json({ ok: true });
  }

  const now = Date.now();
  for (const [key, seenAt] of seenIdempotencyKeys) {
    if (now - seenAt > IDEMPOTENCY_WINDOW_MS) seenIdempotencyKeys.delete(key);
  }
  if (seenIdempotencyKeys.has(idempotencyKey)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const turnstileResult = await verifyTurnstileToken(
    payload.turnstileToken,
    ip
  );
  if (turnstileResult.configured && !turnstileResult.success) {
    return jsonError("Bot verification failed. Please try again.", 400);
  }

  seenIdempotencyKeys.set(idempotencyKey, now);

  const { sent } = await sendBookAuditEmails(payload);

  console.info("[book-audit] submission accepted", {
    ip,
    trade: payload.trade,
    preferredLanguage: payload.preferredLanguage,
    emailSent: sent,
  });

  return NextResponse.json({ ok: true, emailSent: sent });
}
