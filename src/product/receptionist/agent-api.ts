/**
 * Shared plumbing for the voice agent's POST endpoints
 * (/api/receptionist/agent/{availability,book,report}).
 *
 * Same trust model as GET /api/receptionist/agent-config: ops bearer (plus
 * X-Ops-Actor in production), the dialed number picks the business by exact
 * match, and nothing the model produced is trusted beyond being validated and
 * bounded here.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { CALL_ID_PATTERN } from "./agent-calls";
import { getReceptionistRuntime } from "./runtime";
import type { ReceptionistConfig } from "./types";

/** A realistic report (200 transcript turns) is well under this. */
const MAX_BODY_BYTES = 256 * 1024;

const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

const short = (max: number) => z.string().max(max).optional();

export const agentBaseSchema = z.object({
  /** The business number that was dialed (E.164). */
  number: z.string().min(10).max(20),
  /** The agent's own call id (the room name): makes every call idempotent. */
  callId: z.string().regex(CALL_ID_PATTERN),
  /** The caller's number as the carrier reported it. */
  from: short(20),
  language: z.enum(["fr", "en"]),
});

export const availabilitySchema = agentBaseSchema.extend({
  preferredTime: short(200),
  issue: short(600),
  serviceAddress: short(300),
});

export const bookSchema = agentBaseSchema.extend({
  startAt: z.string().min(10).max(40),
  serviceId: short(80),
  serviceName: short(120),
  timezone: short(60),
  callerName: short(80),
  callbackE164: short(20),
  serviceAddress: short(300),
});

const slotsSchema = z
  .object({
    callerName: short(80),
    serviceAddress: short(300),
    issue: short(600),
    callbackE164: short(20),
    preferredTime: short(200),
    message: short(600),
    service: short(120),
    project: short(300),
    location: short(120),
    email: short(120),
  })
  .partial();

export const reportSchema = agentBaseSchema.extend({
  intent: z
    .enum(["service_request", "appointment", "faq", "transfer", "message", "other"])
    .optional(),
  slots: slotsSchema.optional(),
  transcript: z
    .array(
      z.object({
        speaker: z.enum(["agent", "caller"]),
        text: z.string().max(2000),
      }),
    )
    .max(400)
    .optional(),
  transfer: z
    .object({ targetName: short(80), completed: z.boolean() })
    .optional(),
  emergency: z.boolean().optional(),
  durationSeconds: z.number().min(0).max(24 * 3600).optional(),
  endReason: z.enum(["completed", "caller_hung_up", "silence", "error"]).optional(),
});

export type AgentRequestContext<S extends z.ZodType> = {
  config: ReceptionistConfig;
  body: z.infer<S>;
  runtime: ReturnType<typeof getReceptionistRuntime>;
};

export async function handleAgentRequest<S extends z.ZodType>(
  request: NextRequest,
  operation: string,
  schema: S,
  run: (ctx: AgentRequestContext<S>) => Promise<unknown>,
): Promise<Response> {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, `receptionist.agent_${operation}`);
  if (audit.missingActor) return missingOpsActorResponse();

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // Field names only: the values may be caller speech.
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: Array.from(
          new Set(parsed.error.issues.map((i) => i.path.join("."))),
        ),
      },
      { status: 400 },
    );
  }
  const body = parsed.data as z.infer<S> & { number: string };

  const runtime = getReceptionistRuntime();
  await runtime.refresh(false);
  // Exact number match only: an unknown number must never be answered as some
  // other business.
  const config = runtime.configs.find(
    (c) => c.enabled && digits(c.phoneNumberE164) === digits(body.number),
  );
  if (!config) {
    return NextResponse.json(
      { error: "No active receptionist for that number." },
      { status: 404 },
    );
  }
  try {
    const result = await run({ config, body, runtime });
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (err) {
    console.error(`[receptionist] agent ${operation} failed`, err);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
