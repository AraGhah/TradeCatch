import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import {
  DemoError,
  MAX_DEMO_STATE_CHARS,
  MAX_DEMO_UTTERANCE,
  runDemoTurn,
} from "@/product/receptionist/demo";
import { getAuthSecret } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

/**
 * Public website demo of the AI receptionist (see product/receptionist/demo.ts).
 * No auth: it has no side effects — no SMS, email, phone call, database write
 * or LLM call. Rate limited per IP. Disable with RECEPTIONIST_DEMO=0.
 */
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    language: z.enum(["fr", "en"]),
    scenario: z.enum(["open", "after_hours"]).default("open"),
  }),
  z.object({
    action: z.literal("say"),
    state: z.string().min(10).max(MAX_DEMO_STATE_CHARS),
    speech: z.string().trim().min(1).max(MAX_DEMO_UTTERANCE),
  }),
]);

function demoSecret(): string | null {
  const configured = getAuthSecret();
  if (configured) return configured;
  // Local development only: never sign demo state with a guessable key in production.
  return process.env.NODE_ENV === "production"
    ? null
    : "dev-only-receptionist-demo-secret";
}

export async function POST(request: NextRequest) {
  if (process.env.RECEPTIONIST_DEMO === "0") {
    return NextResponse.json({ error: "Demo disabled" }, { status: 404 });
  }

  const secret = demoSecret();
  if (!secret) {
    return NextResponse.json({ error: "Demo unavailable" }, { status: 503 });
  }

  const { allowed } = await rateLimitAsync({
    key: `receptionist-demo:${getClientIp(request)}`,
    limit: 60,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "rate_limited" },
      { status: 429 },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_DEMO_STATE_CHARS + 2000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await runDemoTurn(parsed.data, secret);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof DemoError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "expired" ? 410 : 400 },
      );
    }
    console.error("[receptionist-demo] failed", err);
    return NextResponse.json({ error: "Demo failed" }, { status: 500 });
  }
}
