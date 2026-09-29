import { after, NextRequest, NextResponse } from "next/server";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { VoicePlan } from "@/product/receptionist/types";
import {
  renderTwiml,
  type TwimlCallbackUrl,
} from "@/product/receptionist/voice";

export const dynamic = "force-dynamic";

/**
 * AI Receptionist Twilio webhooks.
 *
 * Point the Twilio number at:
 * - A call comes in        → POST /api/twilio/voice/receptionist/incoming
 * - Call status changes    → POST /api/twilio/voice/receptionist/status
 * `gather`, `dial` and `voicemail` are TwiML action callbacks the engine emits.
 */
const STEPS = new Set(["incoming", "gather", "dial", "voicemail", "status"]);

function xml(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function emptyTwiml() {
  return xml(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
}

async function parseForm(
  request: NextRequest,
): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }
  return params;
}

function callbackUrlFor(request: NextRequest): TwimlCallbackUrl {
  const base = (
    process.env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() ||
    request.nextUrl.origin
  ).replace(/\/$/, "");
  return (step, sessionId) => {
    const url = `${base}/api/twilio/voice/receptionist/${step}`;
    return sessionId ? `${url}?session=${encodeURIComponent(sessionId)}` : url;
  };
}

/**
 * Run after the TwiML response is sent (Next `after` → Workers `waitUntil`).
 * Outside a request scope (tests, scripts) fall back to running inline so the
 * work is never silently dropped.
 */
async function deferTask(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ step: string }> },
) {
  const { step } = await params;
  if (!STEPS.has(step)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let form: Record<string, string>;
  try {
    form = await parseForm(request);
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }

  if (!(await assertTwilioWebhook(request, form))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const callbackUrl = callbackUrlFor(request);
  const render = (plan: VoicePlan) => xml(renderTwiml(plan, callbackUrl));
  const sessionId = request.nextUrl.searchParams.get("session")?.trim() || null;

  let runtime: ReturnType<typeof getReceptionistRuntime>;
  try {
    runtime = getReceptionistRuntime();
    // Pick up tenant profile edits / activations (cached ~30 s per instance).
    await runtime.refresh();
  } catch (err) {
    console.error("[receptionist] runtime unavailable", err);
    if (step === "status") return emptyTwiml();
    // No runtime means no config either: generic apology + hang up.
    return xml(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Gabrielle-Neural" language="fr-CA">Désolée, nous éprouvons un problème technique. Veuillez rappeler plus tard.</Say><Say voice="Polly.Joanna-Neural" language="en-US">Sorry, we are having a technical issue. Please call back later.</Say><Hangup/></Response>`,
    );
  }
  const { engine, store } = runtime;

  try {
    switch (step) {
      case "incoming":
        return render(
          await engine.startCall({
            callSid: form.CallSid || `CA_unknown_${Date.now()}`,
            fromE164: form.From || form.Caller || "",
            toE164: form.To || form.Called || "",
          }),
        );

      case "gather":
        if (!sessionId)
          return render({ sessionId: null, verbs: [{ verb: "hangup" }] });
        return render(
          await engine.handleGather({
            sessionId,
            speech: form.SpeechResult ?? "",
            digits: form.Digits,
            confidence: num(form.Confidence),
            defer: (task) => void deferTask(task),
          }),
        );

      case "dial":
        if (!sessionId)
          return render({ sessionId: null, verbs: [{ verb: "hangup" }] });
        return render(
          await engine.handleDialResult({
            sessionId,
            dialStatus: form.DialCallStatus ?? "failed",
            durationSeconds: num(form.DialCallDuration),
          }),
        );

      case "voicemail":
        if (!sessionId) {
          // Fail-safe voicemail with no session: keep the recording visible to ops.
          console.error("[receptionist] orphan voicemail", {
            callSid: form.CallSid,
            from: form.From,
            recordingUrl: form.RecordingUrl,
          });
          return render({ sessionId: null, verbs: [{ verb: "hangup" }] });
        }
        return render(
          await engine.handleVoicemail({
            sessionId,
            recordingUrl: form.RecordingUrl,
            durationSeconds: num(form.RecordingDuration),
          }),
        );

      case "status": {
        const callSid = form.CallSid;
        if (callSid) {
          const callStatus = form.CallStatus ?? "";
          const durationSeconds = num(form.CallDuration);
          // Summaries + notifications can take a few seconds; respond first.
          await deferTask(async () => {
            try {
              await engine.handleCallStatus({
                callSid,
                callStatus,
                durationSeconds,
              });
            } catch (err) {
              console.error("[receptionist] status finalize failed", err);
            }
          });
        }
        return emptyTwiml();
      }
    }
  } catch (err) {
    console.error(`[receptionist] ${step} failed`, err);
    if (step === "status") return emptyTwiml();
    let config = null;
    let language: "fr" | "en" | undefined;
    if (sessionId) {
      try {
        const session = await store.getSession(sessionId);
        if (session) {
          config =
            runtime.configs.find((c) => c.id === session.configId) ?? null;
          language = session.language;
        }
      } catch {
        /* fall through to the generic fail-safe */
      }
    } else if (step === "incoming") {
      config = engine.resolveConfig(form.To || form.Called || "");
    }
    return render(engine.failSafePlan(config, sessionId, language));
  }

  return emptyTwiml();
}
