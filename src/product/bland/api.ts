/**
 * Shared plumbing for the Bland agent's tool endpoints (/api/bland/*).
 *
 * Trust model, in the order it is applied to every request:
 *
 *   1. Bearer BLAND_TOOL_SECRET (auth.ts): a secret that opens nothing else.
 *   2. Bounded, validated input. Field names only in errors: values may be
 *      caller speech.
 *   3. The business comes from the dialed number through the operator's
 *      trusted route table (tenant.ts), with the CURRENT plan applied.
 *   4. A per-call limit (`tools.bland-call`) so a looping agent cannot hammer
 *      the calendar.
 *
 * What Bland supplies itself, and the model never does: `to`, `from` and
 * `call_id` are Bland's own call variables ({{to}}, {{from}}, {{call_id}}).
 * The caller's number is therefore the carrier's caller ID, which is what the
 * appointment ownership checks rely on.
 *
 * Business outcomes ("that time was taken", "details missing") are HTTP 200
 * with `ok: true` and a `status`; only protocol and infrastructure failures
 * use other codes, so Bland's tool never hides a normal answer behind an error.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforcePolicy } from "@/lib/rate-limit-response";
import { safeDatabaseErrorCode } from "@/lib/postgres-pool";
import { parsePhoneInput } from "@/product/crm/phone";
import { CALL_ID_PATTERN, CallTenantMismatchError } from "@/product/receptionist/agent-calls";
import { TRANSIENT_DB_CODES } from "@/product/receptionist/agent-api";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { ReceptionistConfig, ReceptionistLanguage } from "@/product/receptionist/types";
import { authorizeBlandTool, blandAuthResponse } from "./auth";
import { resolveBlandTenant, type BlandTenant } from "./tenant";

/** A realistic tool call is a few hundred bytes. */
export const MAX_TOOL_BODY_BYTES = 32 * 1024;

/**
 * What the model left out arrives as "" or, when Bland could not fill it, as
 * the literal template ("{{input.caller_name}}"). Neither is something the
 * caller said: both mean "not given", so a blank can never overwrite a value
 * that was already confirmed and a template can never be saved as a name.
 */
function given(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || /^\{\{[^{}]*\}\}$/.test(text)) return undefined;
  return text;
}

const short = (max: number) => z.string().max(max).optional().transform(given);

/** "fr", "fr-CA", "EN" -> fr/en; anything else (an unresolved variable) -> undefined. */
const languageField = z
  .string()
  .max(20)
  .optional()
  .transform((value): ReceptionistLanguage | undefined => {
    const prefix = value?.trim().toLowerCase().slice(0, 2);
    return prefix === "fr" || prefix === "en" ? prefix : undefined;
  });

/** Bland renders every template value as text, so booleans arrive as "true". */
export const boolField = z
  .union([z.boolean(), z.string().max(8)])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    return ["true", "yes", "1"].includes((value ?? "").trim().toLowerCase());
  });

export const blandBaseSchema = z.object({
  /** {{to}}: the Bland number that was dialed. Picks the business. */
  to: z.string().min(10).max(20),
  /** {{call_id}}: Bland's call id. Makes every operation idempotent per call. */
  call_id: z.string().regex(CALL_ID_PATTERN),
  /** {{from}}: the caller's number as the carrier reported it. */
  from: short(40),
  language: languageField,
});

export const configQuerySchema = blandBaseSchema;

export const availabilitySchema = blandBaseSchema.extend({
  preferred_time: short(200),
  issue: short(600),
  /** Offer new times for this existing appointment (found earlier in the call). */
  appointment_id: short(120),
  caller_name: short(80),
});

export const bookSchema = blandBaseSchema.extend({
  start_at: z.string().min(10).max(40),
  service_id: short(80),
  service_name: short(120),
  timezone: short(60),
});

export const detailsSchema = blandBaseSchema.extend({
  caller_name: short(80),
  callback_phone: short(40),
  use_caller_id: boolField,
  /** Everything in one string, or the parts below (the parts win). */
  address: short(300),
  street: short(120),
  unit: short(20),
  city: short(80),
  province: short(40),
  postal_code: short(12),
});

export const appointmentActionSchema = z.discriminatedUnion("action", [
  blandBaseSchema.extend({ action: z.literal("find"), caller_name: short(80) }),
  blandBaseSchema.extend({
    action: z.literal("move"),
    caller_name: short(80),
    appointment_id: z.string().min(1).max(120),
    start_at: z.string().min(10).max(40),
  }),
  blandBaseSchema.extend({
    action: z.literal("cancel"),
    caller_name: short(80),
    appointment_id: z.string().min(1).max(120),
  }),
  blandBaseSchema.extend({
    action: z.literal("text"),
    caller_name: short(80),
    kind: z.enum(["business_info", "appointment"]),
    appointment_id: short(120),
  }),
]);

export const reportSchema = blandBaseSchema.extend({
  intent: z
    .enum(["service_request", "appointment", "faq", "transfer", "message", "other"])
    .optional()
    .catch(undefined),
  issue: short(600),
  service: short(120),
  project: short(300),
  preferred_time: short(200),
  message: short(600),
  email: short(120),
  location: short(120),
  emergency: boolField,
});

export type BlandContext<B> = {
  tenant: BlandTenant;
  config: ReceptionistConfig;
  body: B;
  callId: string;
  /** The carrier's caller ID as E.164, or undefined when withheld or unreadable. */
  callerE164?: string;
  language: ReceptionistLanguage;
  runtime: ReturnType<typeof getReceptionistRuntime>;
  now: Date;
};

type BaseBody = { to: string; call_id: string; from?: string; language?: ReceptionistLanguage };

function fail(status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, error, ...extra },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

async function readInput(
  request: NextRequest,
  method: "GET" | "POST",
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (method === "GET") {
    const params = new URL(request.url).searchParams;
    const value: Record<string, string> = {};
    let count = 0;
    for (const [key, v] of params) {
      if (++count > 20) break;
      if (!(key in value)) value[key] = v;
    }
    return { ok: true, value };
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_TOOL_BODY_BYTES) {
    return { ok: false, response: fail(413, "Payload too large.") };
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_TOOL_BODY_BYTES) {
    return { ok: false, response: fail(413, "Payload too large.") };
  }
  try {
    const json: unknown = JSON.parse(text);
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, response: fail(400, "Body must be a JSON object.") };
    }
    return { ok: true, value: json };
  } catch {
    return { ok: false, response: fail(400, "Body must be JSON.") };
  }
}

export async function handleBlandRequest<S extends z.ZodType<BaseBody>>(
  request: NextRequest,
  operation: string,
  schema: S,
  run: (ctx: BlandContext<z.infer<S>>) => Promise<unknown>,
  options: { method?: "GET" | "POST" } = {},
): Promise<Response> {
  const auth = authorizeBlandTool(request);
  if (!auth.ok) return blandAuthResponse(auth);

  const input = await readInput(request, options.method ?? "POST");
  if (!input.ok) return input.response;
  const parsed = schema.safeParse(input.value);
  if (!parsed.success) {
    // Field names only: the values may be caller speech.
    return fail(400, "Invalid request.", {
      fields: Array.from(new Set(parsed.error.issues.map((i) => i.path.join(".")))),
    });
  }
  const body = parsed.data as z.infer<S>;

  const resolved = await resolveBlandTenant(body.to);
  if (!resolved.ok) {
    return fail(resolved.status, "No active receptionist for that number.", {
      code: resolved.code,
    });
  }
  const { tenant } = resolved;
  const limited = await enforcePolicy("tools.bland-call", {
    subject: `${tenant.config.id}:${body.call_id}`,
  });
  if (limited) return limited;

  const runtime = getReceptionistRuntime();
  try {
    const result = await run({
      tenant,
      config: tenant.config,
      body,
      callId: body.call_id,
      callerE164: parsePhoneInput((body.from ?? "").slice(0, 40)) ?? undefined,
      language: body.language ?? tenant.config.defaultLanguage,
      runtime,
      now: new Date(),
    });
    return NextResponse.json(
      { ok: true, ...(result as object) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof CallTenantMismatchError) {
      console.warn(
        JSON.stringify({ event: "tradecatch.bland.call_conflict", operation, configId: tenant.config.id }),
      );
      return fail(409, "This call belongs to another receptionist.", { code: "call_conflict" });
    }
    // Structured and value-free: a driver message can quote row values.
    const sqlState = safeDatabaseErrorCode(err);
    console.error(
      JSON.stringify({
        event: "tradecatch.bland.request_failed",
        operation,
        callId: body.call_id,
        code: err instanceof Error ? err.name : "Error",
        sqlState,
      }),
    );
    const transient = sqlState !== undefined && TRANSIENT_DB_CODES.has(sqlState);
    return fail(
      transient ? 503 : 500,
      transient ? "Temporarily unavailable." : "Internal error.",
      {},
      transient ? { "Retry-After": "5" } : {},
    );
  }
}
