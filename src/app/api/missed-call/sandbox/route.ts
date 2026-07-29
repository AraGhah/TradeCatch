import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

export const dynamic = "force-dynamic";

/**
 * Local / staging sandbox to drive Module A without Twilio.
 * Disabled in production unless MISSED_CALL_SANDBOX=1.
 * Always requires ops bearer auth when enabled in production.
 */
const callSchema = z.object({
  action: z.literal("call"),
  callerE164: z.string().min(8),
  answered: z.boolean().default(false),
  abandoned: z.boolean().default(false),
  calledAt: z.string().datetime().optional(),
});

const smsSchema = z.object({
  action: z.literal("sms"),
  fromE164: z.string().min(8),
  toE164: z.string().min(8).optional(),
  body: z.string(),
  mediaUrls: z.array(z.string().url()).optional(),
});

const schema = z.discriminatedUnion("action", [callSchema, smsSchema]);

function sandboxEnabled() {
  return (
    process.env.MISSED_CALL_SANDBOX === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

export async function POST(request: NextRequest) {
  if (!sandboxEnabled()) {
    return NextResponse.json({ error: "Sandbox disabled" }, { status: 404 });
  }
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { engine, store } = await ensureMissedCallReady();
  const clientId =
    process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo";
  const client = await store.getClient(clientId);

  if (parsed.data.action === "call") {
    const result = await engine.handleCallEvent({
      clientAccountId: clientId,
      callerE164: parsed.data.callerE164,
      answered: parsed.data.answered,
      abandoned: parsed.data.abandoned,
      calledAt: parsed.data.calledAt
        ? new Date(parsed.data.calledAt)
        : undefined,
    });
    return NextResponse.json({
      ok: true,
      call: result.call,
      workflowId: result.workflow?.id ?? null,
      smsSent: result.smsSent,
      suppressedReason: result.suppressedReason,
      status: result.workflow?.status,
    });
  }

  const toE164 =
    parsed.data.toE164 || client?.smsFromNumber || "+15145550100";
  const result = await engine.handleInboundSms({
    fromE164: parsed.data.fromE164,
    toE164,
    body: parsed.data.body,
    mediaUrls: parsed.data.mediaUrls,
  });

  const wf = await store.findActiveWorkflowByCaller(
    clientId,
    parsed.data.fromE164,
  );
  // Also load completed workflow via technician path — return latest if any
  return NextResponse.json({
    ok: true,
    handled: result.handled,
    replies: result.replies,
    workflow: wf
      ? {
          id: wf.id,
          status: wf.status,
          step: wf.currentStep,
          outcome: wf.outcome,
          collected: wf.collected,
          events: wf.events.map((e) => e.type),
        }
      : null,
  });
}

export async function GET(request: NextRequest) {
  if (!sandboxEnabled()) {
    return NextResponse.json({ error: "Sandbox disabled" }, { status: 404 });
  }
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  return NextResponse.json({
    ok: true,
    module: "missed-call-recovery",
    endpoints: {
      call: { action: "call", callerE164: "+1…", answered: false, abandoned: false },
      sms: { action: "sms", fromE164: "+1…", body: "…" },
    },
  });
}
