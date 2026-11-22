/**
 * ConversationRelay WebSocket bridge on Cloudflare.
 *
 * Twilio opens one socket per call. The Worker entry checks its signature and
 * hands it to a Durable Object named after the receptionist session, which
 * keeps it open (hibernating between turns) and does no thinking of its own:
 * each caller turn is POSTed, signed, to /api/voice/relay/turn over the
 * Worker's self binding, where the regular receptionist engine answers it.
 * The answer comes back as text tokens Twilio speaks with ElevenLabs.
 *
 * Only relay-plan and relay-auth are imported: this file is bundled into the
 * Worker entry, outside the OpenNext bundle.
 */

import {
  RELAY_TURN_HEADER,
  relaySocketUrlCandidates,
  signRelayTurn,
  validateTwilioSocketSignature,
} from "./relay-auth";
import {
  estimateSpeechMs,
  parseRelayTurn,
  type RelayHandoff,
  type RelayTurn,
} from "./relay-plan";

export const RELAY_SOCKET_PATH = "/api/voice/socket";
export const RELAY_TURN_PATH = "/api/voice/relay/turn";

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_MESSAGE_CHARS = 65_536;
const TURN_TIMEOUT_MS = 15_000;

export type RelayEnv = {
  VOICE_RELAY?: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
  };
  WORKER_SELF_REFERENCE?: Fetcher;
  TWILIO_AUTH_TOKEN?: string;
  MISSED_CALL_PUBLIC_WEBHOOK_BASE?: string;
  NEXT_PUBLIC_SITE_URL?: string;
};

export type RelayTurnRequest = {
  sessionId: string;
  callSid: string;
  kind: "prompt" | "dtmf" | "silence";
  speech?: string;
  digits?: string;
};

type Attachment = {
  sessionId: string;
  callSid: string | null;
  /** Language Twilio is listening in; set from the intro, then by switches. */
  language?: string | null;
};
type Pending = { kind: "end"; handoff: RelayHandoff } | { kind: "silence" };

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function relayOrigin(env: RelayEnv): string {
  const base =
    env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() ||
    env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://tradecatch.ca";
  return new URL(base).origin;
}

function logRelay(event: string, detail: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ event: `tradecatch.voice_relay.${event}`, ...detail }));
}

/**
 * Worker entry hook. Returns null for anything that is not a Twilio socket
 * upgrade on the relay path, so the request carries on to Next unchanged.
 */
export async function routeRelayUpgrade(
  request: Request,
  env: RelayEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== RELAY_SOCKET_PATH) return null;
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return null;

  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!env.VOICE_RELAY || !token) {
    logRelay("unavailable", { binding: !!env.VOICE_RELAY, token: !!token });
    return plain(503, "Voice relay unavailable");
  }
  const valid = await validateTwilioSocketSignature({
    authToken: token,
    signature: request.headers.get("x-twilio-signature") ?? "",
    urls: relaySocketUrlCandidates(request.url, env.MISSED_CALL_PUBLIC_WEBHOOK_BASE),
  });
  if (!valid) return plain(403, "Invalid signature");

  const sessionId = url.searchParams.get("session")?.trim() ?? "";
  if (!SESSION_ID.test(sessionId)) return plain(400, "Missing session");
  const stub = env.VOICE_RELAY.get(env.VOICE_RELAY.idFromName(sessionId));
  return stub.fetch(request);
}

export class VoiceRelaySession {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: RelayEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return plain(426, "Expected WebSocket");
    }
    const sessionId = new URL(request.url).searchParams.get("session")?.trim() ?? "";
    if (!SESSION_ID.test(sessionId)) return plain(400, "Missing session");

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionId, callSid: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.serial(() => this.onMessage(ws, message));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.clearPending();
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) {
      ws.close(code, reason);
    } else {
      ws.close();
    }
  }

  async webSocketError(): Promise<void> {
    await this.clearPending();
  }

  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.get<Pending>("pending");
    await this.ctx.storage.delete("pending");
    const ws = this.ctx.getWebSockets()[0];
    if (!pending || !ws) return;
    if (pending.kind === "end") {
      this.sendEnd(ws, pending.handoff);
      return;
    }
    // The caller said nothing for the whole listening window: the engine's
    // no-input path (re-prompt, then a polite goodbye) takes it from here.
    await this.serial(async () => {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment?.callSid) await this.turn(ws, attachment, { kind: "silence" });
    });
  }

  /** Turns run one at a time, in arrival order, per call. */
  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async onMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_CHARS) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    switch (msg.type) {
      case "setup": {
        const params = (msg.customParameters ?? {}) as Record<string, unknown>;
        if (params.sessionId !== attachment.sessionId || typeof msg.callSid !== "string") {
          logRelay("setup_rejected");
          ws.close(1008, "Session mismatch");
          return;
        }
        const ready: Attachment = { ...attachment, callSid: msg.callSid };
        ws.serializeAttachment(ready);
        const intro = parseRelayTurn(params.intro);
        if (intro) await this.apply(ws, intro);
        return;
      }
      case "prompt": {
        if (msg.last === false || !attachment.callSid) return;
        if (!(await this.callerMayTalk())) return;
        await this.turn(ws, attachment, {
          kind: "prompt",
          speech: typeof msg.voicePrompt === "string" ? msg.voicePrompt : "",
        });
        return;
      }
      case "dtmf": {
        if (!attachment.callSid || typeof msg.digit !== "string") return;
        if (!(await this.callerMayTalk())) return;
        await this.turn(ws, attachment, { kind: "dtmf", digits: msg.digit });
        return;
      }
      case "error":
        logRelay("twilio_error", {
          description:
            typeof msg.description === "string" ? msg.description.slice(0, 200) : undefined,
        });
        return;
      default:
        // interrupt / info: Twilio already stopped speaking; nothing to do.
        return;
    }
  }

  /**
   * Speech cancels the silence timer. Once the call is ending (goodbye or
   * transfer line being spoken) further speech is ignored.
   */
  private async callerMayTalk(): Promise<boolean> {
    const pending = await this.ctx.storage.get<Pending>("pending");
    if (pending?.kind === "end") return false;
    if (pending) await this.clearPending();
    return true;
  }

  private async clearPending(): Promise<void> {
    await this.ctx.storage.delete("pending");
    await this.ctx.storage.deleteAlarm();
  }

  private async turn(
    ws: WebSocket,
    attachment: Attachment,
    input: Omit<RelayTurnRequest, "sessionId" | "callSid">,
  ): Promise<void> {
    let result: RelayTurn;
    try {
      result = await this.runTurn({
        ...input,
        sessionId: attachment.sessionId,
        callSid: attachment.callSid!,
      });
    } catch (error) {
      logRelay("turn_failed", {
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
      result = {
        tokens: [],
        listenSeconds: null,
        end: { action: "fallback", sessionId: attachment.sessionId },
      };
    }
    await this.apply(ws, result);
  }

  private async runTurn(input: RelayTurnRequest): Promise<RelayTurn> {
    const token = this.env.TWILIO_AUTH_TOKEN?.trim();
    const self = this.env.WORKER_SELF_REFERENCE;
    if (!token || !self) throw new Error("relay turn not configured");
    const body = JSON.stringify(input);
    const response = await self.fetch(`${relayOrigin(this.env)}${RELAY_TURN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [RELAY_TURN_HEADER]: await signRelayTurn(token, body),
      },
      body,
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`relay turn ${response.status}`);
    }
    const turn = parseRelayTurn(await response.text());
    if (!turn) throw new Error("relay turn unreadable");
    return turn;
  }

  private async apply(ws: WebSocket, turn: RelayTurn): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (turn.language && attachment && attachment.language !== turn.language) {
      // The TwiML already set the first language; later changes (the caller
      // chose English) must reach Twilio's transcription too.
      if (attachment.language) {
        ws.send(
          JSON.stringify({
            type: "language",
            ttsLanguage: turn.language,
            transcriptionLanguage: turn.language,
          }),
        );
      }
      ws.serializeAttachment({ ...attachment, language: turn.language } satisfies Attachment);
    }
    for (const token of turn.tokens) {
      ws.send(JSON.stringify({ type: "text", token: token.text, lang: token.lang, last: true }));
    }
    const speakingMs = estimateSpeechMs(turn.tokens);
    if (turn.end) {
      if (speakingMs === 0) {
        this.sendEnd(ws, turn.end);
        return;
      }
      // "end" stops the relay at once; wait for the last sentence to be heard.
      await this.ctx.storage.put("pending", { kind: "end", handoff: turn.end } satisfies Pending);
      await this.ctx.storage.setAlarm(Date.now() + speakingMs);
      return;
    }
    if (turn.listenSeconds) {
      await this.ctx.storage.put("pending", { kind: "silence" } satisfies Pending);
      await this.ctx.storage.setAlarm(Date.now() + speakingMs + turn.listenSeconds * 1000);
    }
  }

  private sendEnd(ws: WebSocket, handoff: RelayHandoff): void {
    ws.send(JSON.stringify({ type: "end", handoffData: JSON.stringify(handoff) }));
  }
}
