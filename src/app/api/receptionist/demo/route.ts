import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import {
  DemoError,
  MAX_DEMO_HISTORY,
  MAX_DEMO_UTTERANCE,
  runDemoTurn,
} from "@/product/receptionist/demo";

export const dynamic = "force-dynamic";

/**
 * Public website demo of the receptionist (see product/receptionist/demo.ts).
 * No auth and no secret: it has no side effects — no SMS, email, phone call,
 * database write or LLM call — and the client only supplies what the caller
 * says, which the server replays from the start of the call. Rate limited per
 * IP. Disable with RECEPTIONIST_DEMO=0.
 */
const utterance = z.string().trim().min(1).max(MAX_DEMO_UTTERANCE);
const language = z.enum(["fr", "en"]);
const scenario = z.enum(["open", "after_hours"]).default("open");

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), language, scenario }),
  z.object({
    action: z.literal("say"),
    language,
    scenario,
    history: z.array(utterance).max(MAX_DEMO_HISTORY).default([]),
    speech: utterance,
  }),
]);

// 13 utterances of 400 characters plus JSON overhead.
const MAX_BODY_CHARS = 8_000;

export async function POST(request: NextRequest) {
  if (process.env.RECEPTIONIST_DEMO === "0") {
    return NextResponse.json({ error: "Demo disabled" }, { status: 404 });
  }

  const { allowed } = await rateLimitAsync({
    key: `receptionist-demo:${getClientIp(request)}`,
    limit: 120,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "rate_limited" },
      { status: 429 },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
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
    const result = await runDemoTurn(parsed.data);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof DemoError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    console.error("[receptionist-demo] failed", err);
    return NextResponse.json({ error: "Demo failed" }, { status: 500 });
  }
}
