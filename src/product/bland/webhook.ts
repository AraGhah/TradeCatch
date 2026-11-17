/**
 * Bland's post-call webhook: the authoritative end of a call.
 *
 * Authenticated by Bland's HMAC signature over the exact body (auth.ts), not
 * by the tool secret. The business is still resolved from the dialed number
 * through the trusted route table, so a signed payload for a number that is
 * not routed here is acknowledged and ignored, never attributed to someone.
 *
 * It finalizes the call exactly like the LiveKit agent's report: the same
 * call record, owner summary, notifications, CRM sync and missed-call
 * recovery. Repeating it (Bland retries) changes nothing. Outbound calls are
 * ignored: this integration answers inbound calls only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeDatabaseErrorCode } from "@/lib/postgres-pool";
import { parsePhoneInput } from "@/product/crm/phone";
import { CALL_ID_PATTERN, CallTenantMismatchError, type AgentReportInput } from "@/product/receptionist/agent-calls";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { blandOwnLines, lineKey } from "./routes";
import { verifyBlandSignature } from "./auth";
import { resolveBlandTenant, type BlandTenant } from "./tenant";
import { resolveBlandTransfers } from "./transfer";

/** Transcripts of long calls are large; this is far above a real one. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

const nullable = <T extends z.ZodType>(schema: T) => schema.nullish();

export const postCallSchema = z.object({
  call_id: z.string().regex(CALL_ID_PATTERN),
  to: z.string().min(10).max(20),
  from: nullable(z.string().max(40)),
  inbound: nullable(z.boolean()),
  transcripts: nullable(
    z
      .array(z.object({ user: z.string().max(30), text: z.string().max(4000) }))
      .max(1000),
  ),
  /** Minutes. */
  call_length: nullable(z.number().min(0).max(24 * 60)),
  corrected_duration: nullable(z.union([z.number(), z.string().max(20)])),
  transferred_to: nullable(z.string().max(40)),
  warm_transfer_call: nullable(z.object({ state: nullable(z.string().max(60)) })),
  status: nullable(z.string().max(40)),
  call_ended_by: nullable(z.string().max(40)),
  variables: nullable(z.record(z.string(), z.unknown())),
});

export type PostCall = z.infer<typeof postCallSchema>;

const FAILED_TRANSFER = /fail|no.?answer|declin|cancel|busy|reject|timeout/i;

function durationSeconds(payload: PostCall): number | undefined {
  if (typeof payload.call_length === "number") return Math.round(payload.call_length * 60);
  const corrected = Number(payload.corrected_duration);
  return Number.isFinite(corrected) && corrected >= 0 && corrected <= 24 * 3600
    ? Math.round(corrected)
    : undefined;
}

/** What the call service needs from Bland's payload. Pure, so it is tested without a server. */
export function mapPostCall(
  payload: PostCall,
  tenant: BlandTenant,
  now: Date,
  env: Record<string, string | undefined> = process.env,
): Omit<AgentReportInput, "callId"> {
  const { config } = tenant;
  const transcript: { speaker: "agent" | "caller"; text: string }[] = [];
  for (const turn of payload.transcripts ?? []) {
    if (turn.user === "user") transcript.push({ speaker: "caller", text: turn.text });
    else if (turn.user === "assistant") transcript.push({ speaker: "agent", text: turn.text });
    // "agent-action" lines are tool traces, not speech.
  }

  let transfer: AgentReportInput["transfer"];
  let emergency = payload.variables?.emergency === true || payload.variables?.emergency === "true";
  if (payload.transferred_to) {
    const { variables } = resolveBlandTransfers({
      config,
      now,
      capabilities: tenant.capabilities,
      ownLines: blandOwnLines(env),
    });
    // The destination is recognised against OUR emergency line, never taken on trust.
    if (
      variables.emergency_transfer_number &&
      lineKey(variables.emergency_transfer_number) === lineKey(payload.transferred_to)
    ) {
      emergency = true;
    }
    const state = payload.warm_transfer_call?.state ?? "";
    transfer = {
      completed: !FAILED_TRANSFER.test(state),
      // A person was not heard accepting: Bland reports a transfer, not an answer.
      answerConfirmed: false,
      mechanism: payload.warm_transfer_call ? "warm" : "blind",
    };
  }

  const ended = (payload.call_ended_by ?? "").toLowerCase();
  const status = (payload.status ?? "").toLowerCase();
  const rawLanguage = String(payload.variables?.language ?? "").slice(0, 2).toLowerCase();
  const language =
    rawLanguage === "fr" || rawLanguage === "en" ? rawLanguage : config.defaultLanguage;

  return {
    fromE164: parsePhoneInput((payload.from ?? "").slice(0, 40)) ?? undefined,
    language,
    transcript,
    transfer,
    emergency: emergency || undefined,
    durationSeconds: durationSeconds(payload),
    endReason: /error|fail/.test(status)
      ? "error"
      : ended.includes("user") || ended.includes("caller")
        ? "caller_hung_up"
        : "completed",
  };
}

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleBlandWebhook(request: NextRequest): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return reply(413, { ok: false, error: "Payload too large." });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_WEBHOOK_BYTES) {
    return reply(413, { ok: false, error: "Payload too large." });
  }

  const signature = verifyBlandSignature(text, request.headers.get("x-webhook-signature"));
  if (signature === "not_configured") {
    return reply(503, { ok: false, error: "Bland webhook is not configured." });
  }
  if (signature !== "ok") return reply(401, { ok: false, error: "Invalid signature." });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, error: "Body must be JSON." });
  }
  const parsed = postCallSchema.safeParse(json);
  if (!parsed.success) {
    return reply(400, {
      ok: false,
      error: "Invalid request.",
      fields: Array.from(new Set(parsed.error.issues.map((i) => i.path.join(".")))),
    });
  }
  const payload = parsed.data;
  if (payload.inbound !== true) {
    return reply(200, { ok: true, ignored: "not_inbound" });
  }

  const resolved = await resolveBlandTenant(payload.to);
  if (!resolved.ok) {
    if (resolved.status === 503) {
      return reply(503, { ok: false, error: "Temporarily unavailable." });
    }
    // Signed by Bland but not ours to record: acknowledge so it is not retried.
    console.warn(
      JSON.stringify({ event: "tradecatch.bland.webhook_ignored", code: resolved.code }),
    );
    return reply(200, { ok: true, ignored: resolved.code });
  }

  const { tenant } = resolved;
  const runtime = getReceptionistRuntime();
  try {
    const session = await runtime.blandCalls.report(tenant.config, {
      callId: payload.call_id,
      ...mapPostCall(payload, tenant, new Date()),
    });
    return reply(200, {
      ok: true,
      recorded: Boolean(session),
      outcome: session?.outcome ?? null,
    });
  } catch (err) {
    if (err instanceof CallTenantMismatchError) {
      return reply(409, { ok: false, error: "This call belongs to another receptionist." });
    }
    console.error(
      JSON.stringify({
        event: "tradecatch.bland.webhook_failed",
        callId: payload.call_id,
        code: err instanceof Error ? err.name : "Error",
        sqlState: safeDatabaseErrorCode(err),
      }),
    );
    // Bland retries a failed webhook: a transient fault should be retried.
    return reply(500, { ok: false, error: "Internal error." });
  }
}
