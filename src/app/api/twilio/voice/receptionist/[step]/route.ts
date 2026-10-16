import { after, NextRequest, NextResponse } from "next/server";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";
import { greetingFor } from "@/product/receptionist/prompts";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { VoicePlan } from "@/product/receptionist/types";
import {
  renderTwiml,
  type TwimlCallbackUrl,
} from "@/product/receptionist/voice";
import { renderConversationRelayTwiml } from "@/product/telephony/conversation-relay";
import { getTelephonyRuntime } from "@/product/telephony/runtime";

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
      case "incoming": {
        const callSid = form.CallSid || `CA_unknown_${Date.now()}`;
        const fromE164 = form.From || form.Caller || "";
        const toE164 = form.To || form.Called || "";
        const plan = await engine.startCall({
          callSid,
          fromE164,
          toE164,
        });
        const session = plan.sessionId
          ? await store.getSession(plan.sessionId)
          : null;
        const config = engine.resolveConfig(toE164);

        try {
          const orgId = config?.id.replace(/^rc_org_/, "") || "unknown";
          const events = getTelephonyRuntime().events;
          if (!(await events.seenRecently({ callSid, kind: "incoming" }))) {
            await events.append({
              organizationId: orgId,
              clientAccountId:
                session?.clientAccountId || config?.clientAccountId || "unknown",
              callSid,
              sessionId: session?.id,
              kind: "incoming",
              detail: `from=${fromE164} to=${toE164}`,
            });
          }
          if (plan.verbs.some((v) => v.verb === "dial")) {
            await events.append({
              organizationId: orgId,
              clientAccountId:
                session?.clientAccountId || config?.clientAccountId || "unknown",
              callSid,
              sessionId: session?.id,
              kind: "human_ring",
              detail: "inbound_strategy",
            });
          } else if (session) {
            await events.append({
              organizationId: orgId,
              clientAccountId: session.clientAccountId,
              callSid,
              sessionId: session.id,
              kind: "ai_started",
              detail: config?.voiceEngine || "gather",
            });
          }
        } catch (err) {
          console.warn("[receptionist] call event write failed", err);
        }

        // ConversationRelay path when configured and the plan is AI (not dial).
        if (
          config?.voiceEngine === "conversation_relay" &&
          plan.sessionId &&
          !plan.verbs.some((v) => v.verb === "dial")
        ) {
          const base = (
            process.env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() ||
            request.nextUrl.origin
          ).replace(/\/$/, "");
          const wsUrl = `${base.replace(/^http/, "ws")}/api/voice/socket`;
          const lang = session?.language || config.defaultLanguage;
          return xml(
            renderConversationRelayTwiml({
              websocketUrl: wsUrl,
              language: lang,
              welcomeGreeting: greetingFor(config, lang),
              actionUrl: `${base}/api/webhooks/twilio/relay-ended`,
              sessionId: plan.sessionId,
            }),
          );
        }

        return render(plan);
      }

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
              const result = await engine.handleCallStatus({
                callSid,
                callStatus,
                durationSeconds,
              });
              if (
                result.finalized &&
                result.session &&
                (result.session.durationSeconds ?? durationSeconds ?? 0) > 0
              ) {
                const { recordAiCallMinutes } = await import(
                  "@/product/billing/recordUsage"
                );
                const { getSaasStore } = await import(
                  "@/product/saas/runtime"
                );
                const orgIdFromConfig = result.session.configId.startsWith(
                  "rc_org_",
                )
                  ? result.session.configId.slice("rc_org_".length)
                  : null;
                let businessId = orgIdFromConfig;
                if (!businessId && result.session.clientAccountId) {
                  const org =
                    await getSaasStore().findOrganizationByMissedCallClientId(
                      result.session.clientAccountId,
                    );
                  businessId = org?.id ?? null;
                }
                if (businessId) {
                  await recordAiCallMinutes({
                    businessId,
                    durationSeconds:
                      result.session.durationSeconds ?? durationSeconds ?? 0,
                    callSid,
                  });
                }
              }
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
