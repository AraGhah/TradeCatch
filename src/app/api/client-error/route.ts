import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/errors";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().max(500),
  digest: z.string().max(120).optional(),
  stack: z.string().max(2000).optional(),
  path: z.string().max(300).nullable().optional(),
});

/**
 * Receives client-side error boundary reports and forwards them to
 * ERROR_WEBHOOK_URL when configured.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = rateLimit({
    key: `client-error:${ip}`,
    limit: 20,
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

  await reportError(new Error(parsed.data.message), {
    digest: parsed.data.digest,
    stack: parsed.data.stack,
    path: parsed.data.path,
    ip,
    source: "client-error-boundary",
  });

  return NextResponse.json({ ok: true });
}
