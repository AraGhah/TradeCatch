import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeOpsRequest, unauthorizedOpsResponse } from "@/lib/ops-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { VoicePlan } from "@/product/receptionist/types";
import { renderTwiml } from "@/product/receptionist/voice";

export const dynamic = "force-dynamic";

/**
 * Drive the AI receptionist without Twilio (local / staging).
 * Disabled in production unless MISSED_CALL_SANDBOX=1. Ops bearer required.
 *
 *   {"action":"start","callSid":"CA_test_1","from":"+15145551234","to":"+15145550000"}
 *   {"action":"say","sessionId":"rcs_…","speech":"J'ai une fuite d'eau"}
 *   {"action":"dial","sessionId":"rcs_…","status":"no-answer"}
 *   {"action":"end","callSid":"CA_test_1","status":"completed","duration":42}
 */
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    callSid: z.string().min(3),
    from: z.string().min(3),
    to: z.string().min(3),
  }),
  z.object({
    action: z.literal("say"),
    sessionId: z.string().min(3),
    speech: z.string().default(""),
    digits: z.string().optional(),
  }),
  z.object({
    action: z.literal("dial"),
    sessionId: z.string().min(3),
    status: z.string().default("completed"),
  }),
  z.object({
    action: z.literal("voicemail"),
    sessionId: z.string().min(3),
    recordingUrl: z.string().url().optional(),
  }),
  z.object({
    action: z.literal("end"),
    callSid: z.string().min(3),
    status: z.string().default("completed"),
    duration: z.number().int().nonnegative().optional(),
  }),
]);

function sandboxEnabled() {
  return (
    process.env.MISSED_CALL_SANDBOX === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

function view(plan: VoicePlan) {
  return {
    sessionId: plan.sessionId,
    verbs: plan.verbs,
    twiml: renderTwiml(
      plan,
      (step, id) =>
        `/api/twilio/voice/receptionist/${step}${id ? `?session=${id}` : ""}`,
    ),
  };
}

export async function POST(request: NextRequest) {
  if (!sandboxEnabled()) {
    return NextResponse.json({ error: "Sandbox disabled" }, { status: 404 });
  }
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const runtime = getReceptionistRuntime();
  await runtime.refresh();
  const { engine, configs } = runtime;
  if (configs.length === 0) {
    return NextResponse.json(
      {
        error:
          "No receptionist profile. Set RECEPTIONIST_CONFIG_JSON or RECEPTIONIST_ENABLED=1.",
      },
      { status: 409 },
    );
  }

  const input = parsed.data;
  switch (input.action) {
    case "start":
      return NextResponse.json({
        ok: true,
        ...view(
          await engine.startCall({
            callSid: input.callSid,
            fromE164: input.from,
            toE164: input.to,
          }),
        ),
      });
    case "say":
      return NextResponse.json({
        ok: true,
        ...view(
          await engine.handleGather({
            sessionId: input.sessionId,
            speech: input.speech,
            digits: input.digits,
          }),
        ),
      });
    case "dial":
      return NextResponse.json({
        ok: true,
        ...view(
          await engine.handleDialResult({
            sessionId: input.sessionId,
            dialStatus: input.status,
          }),
        ),
      });
    case "voicemail":
      return NextResponse.json({
        ok: true,
        ...view(
          await engine.handleVoicemail({
            sessionId: input.sessionId,
            recordingUrl: input.recordingUrl,
          }),
        ),
      });
    case "end": {
      const result = await engine.handleCallStatus({
        callSid: input.callSid,
        callStatus: input.status,
        durationSeconds: input.duration,
      });
      return NextResponse.json({
        ok: true,
        finalized: result.finalized,
        summary: result.session?.summary ?? null,
        notifications: result.session?.notifications ?? [],
      });
    }
  }
}
