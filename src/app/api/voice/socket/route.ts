import { NextRequest, NextResponse } from "next/server";
import { isOpsSandboxEnabled } from "@/lib/environment";
import { authorizeOpsRequest, unauthorizedOpsResponse } from "@/lib/ops-auth";
import {
  createRelayConversation,
  parseRelayMessage,
} from "@/product/telephony/conversation-relay";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { greetingFor } from "@/product/receptionist/prompts";

export const dynamic = "force-dynamic";

/**
 * ConversationRelay WebSocket endpoint.
 *
 * Cloudflare Workers need Durable Objects for production WebSocket fan-out.
 * Until a DO binding is configured, this route:
 * - Rejects native WS upgrades with a clear error (so Twilio/logs show why).
 * - Accepts POST JSON messages for staging/simulated relay turns (same protocol).
 *
 * The POST path runs against real client receptionist configs and echoes the
 * transfer numbers they hold, so it is a sandbox: same gate as
 * /api/receptionist/sandbox (404 on real production unless MISSED_CALL_SANDBOX=1,
 * ops bearer required everywhere else). It must never be anonymous.
 */
export async function GET(request: NextRequest) {
  const upgrade = request.headers.get("upgrade");
  if (upgrade?.toLowerCase() === "websocket") {
    return NextResponse.json(
      {
        error: "WebSocket is not available on this endpoint.",
        code: "ws_not_configured",
      },
      { status: 501 },
    );
  }
  return NextResponse.json({
    ok: true,
    protocol: "conversation_relay",
    websocket: false,
  });
}

export async function POST(request: NextRequest) {
  if (!isOpsSandboxEnabled()) {
    return NextResponse.json({ error: "Sandbox disabled" }, { status: 404 });
  }
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();

  let body: { message?: unknown; configId?: string; toE164?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof body.message === "string"
      ? body.message
      : JSON.stringify(body.message ?? {});
  const msg = parseRelayMessage(raw);
  if (!msg) {
    return NextResponse.json(
      { error: "Invalid relay message" },
      { status: 400 },
    );
  }

  const runtime = getReceptionistRuntime();
  await runtime.refresh();
  const config =
    (body.configId
      ? runtime.configs.find((c) => c.id === body.configId)
      : null) ||
    (body.toE164 ? runtime.engine.resolveConfig(body.toE164) : null) ||
    runtime.configs[0];

  if (!config) {
    return NextResponse.json(
      { error: "No receptionist config available" },
      { status: 409 },
    );
  }

  const relay = createRelayConversation(config);

  if (msg.type === "setup") {
    await relay.onSetup({
      callSid: msg.callSid || `sim_relay_${Date.now()}`,
      fromE164: msg.from || "+15145550177",
      toE164: msg.to || config.phoneNumberE164,
    });
    return NextResponse.json({
      ok: true,
      outbound: [
        {
          type: "text",
          token: greetingFor(config, config.defaultLanguage),
          last: true,
        },
      ],
    });
  }

  if (msg.type === "prompt") {
    const outbound = await relay.onPrompt(msg.voicePrompt || "");
    return NextResponse.json({
      ok: true,
      outbound,
      session: await relay.getSession(),
    });
  }

  return NextResponse.json({ ok: true, outbound: [] });
}
