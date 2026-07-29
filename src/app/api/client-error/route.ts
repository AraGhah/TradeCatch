import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/errors";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().max(300),
  digest: z.string().max(80).optional(),
  /** Client may send a stack; we sanitize heavily before forwarding. */
  stack: z.string().max(1200).optional(),
  path: z.string().max(200).nullable().optional(),
  buildId: z.string().max(64).optional(),
  sessionId: z.string().max(64).optional(),
});

/** In-process dedupe of identical fingerprints within a window. */
const recentFingerprints = new Map<string, number>();
const DEDUPE_MS = 10 * 60 * 1000;
const SAMPLE_RATE = 0.35;

function sanitizeText(value: string, max: number): string {
  return value
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F]/g, "?")
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/gi, "[redacted-email]")
    .replace(/\b\+?\d[\d\s().-]{8,}\d\b/g, "[redacted-phone]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .slice(0, max);
}

function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = sanitizeText(stack, 800)
    .split("\n")
    .slice(0, 6)
    .map((line) => line.replace(/\(.*?\)/g, "(…)").slice(0, 160));
  return lines.join("\n") || undefined;
}

function pruneDedupe(now: number) {
  for (const [key, at] of recentFingerprints) {
    if (now - at > DEDUPE_MS) recentFingerprints.delete(key);
  }
}

/**
 * Receives client-side error boundary reports and forwards a sanitized,
 * deduplicated, sampled payload to ERROR_WEBHOOK_URL when configured.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = rateLimit({
    key: `client-error:${ip}`,
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const message = sanitizeText(parsed.data.message, 240);
  const path = parsed.data.path
    ? sanitizeText(parsed.data.path, 160)
    : undefined;
  const digest = parsed.data.digest
    ? sanitizeText(parsed.data.digest, 80)
    : undefined;
  const buildId = parsed.data.buildId
    ? sanitizeText(parsed.data.buildId, 64)
    : process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 64);
  const sessionId = parsed.data.sessionId
    ? sanitizeText(parsed.data.sessionId, 64)
    : undefined;
  const stack = sanitizeStack(parsed.data.stack);

  const fingerprint = createHash("sha256")
    .update([message, path ?? "", digest ?? "", buildId ?? ""].join("|"))
    .digest("hex")
    .slice(0, 24);

  const now = Date.now();
  pruneDedupe(now);
  if (recentFingerprints.has(fingerprint)) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  recentFingerprints.set(fingerprint, now);

  // Always keep framework digests; sample anonymous free-text noise.
  const sampleBucket =
    Number.parseInt(fingerprint.slice(0, 2), 16) / 255;
  if (!digest && sampleBucket > SAMPLE_RATE) {
    return NextResponse.json({ ok: true, sampled: false });
  }

  await reportError(new Error(message), {
    digest,
    stack,
    path,
    ip,
    buildId,
    sessionId,
    fingerprint,
    source: "client-error-boundary",
  });

  return NextResponse.json({ ok: true });
}
