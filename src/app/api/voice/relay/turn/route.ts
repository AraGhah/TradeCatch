import { after, NextRequest, NextResponse } from "next/server";
import { withPostgresRequestScope } from "@/lib/postgres-pool";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";
import { logReceptionistDiagnostic } from "@/product/receptionist/diagnostics";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  RELAY_TURN_HEADER,
  verifyRelayTurn,
} from "@/product/telephony/relay-auth";
import { planToRelay } from "@/product/telephony/relay-plan";
import type { RelayTurnRequest } from "@/product/telephony/relay-session";

export const dynamic = "force-dynamic";

const MAX_TURN_BYTES = 16_384;

/**
 * One caller turn of a ConversationRelay call. Called only by the
 * VoiceRelaySession Durable Object (src/product/telephony/relay-session.ts),
 * which signs the body with a key derived from TWILIO_AUTH_TOKEN. The answer
 * is the same engine plan a <Gather> callback would get, as relay tokens.
 */
export async function POST(request: NextRequest) {
  let raw: string;
  try {
    raw = await readBodyText(request, MAX_TURN_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const signed = await verifyRelayTurn({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    header: request.headers.get(RELAY_TURN_HEADER),
    body: raw,
  });
  if (!signed) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let turn: RelayTurnRequest;
  try {
    turn = JSON.parse(raw) as RelayTurnRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof turn?.sessionId !== "string" ||
    typeof turn.callSid !== "string" ||
    !["prompt", "dtmf", "silence"].includes(turn.kind)
  ) {
    return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
  }

  return withPostgresRequestScope(async () => {
    const runtime = getReceptionistRuntime();
    await runtime.refresh();
    const session = await runtime.store.getSession(turn.sessionId);
    // The socket is bound to one call; a session id from another call is refused.
    if (!session || session.callSid !== turn.callSid) {
      return NextResponse.json({ error: "Unknown session" }, { status: 404 });
    }
    try {
      const plan = await runtime.engine.handleGather({
        sessionId: session.id,
        speech:
          turn.kind === "prompt" ? (turn.speech ?? "").slice(0, 2_000) : "",
        digits: turn.kind === "dtmf" ? turn.digits?.slice(0, 32) : undefined,
        callSid: turn.callSid,
        defer: (task) => {
          try {
            after(task);
          } catch {
            void task();
          }
        },
      });
      return NextResponse.json(planToRelay(plan));
    } catch (error) {
      logReceptionistDiagnostic({
        event: "relay_turn_failed",
        step: "gather",
        callSid: turn.callSid,
        error,
      });
      return NextResponse.json({ error: "Turn failed" }, { status: 500 });
    }
  });
}
