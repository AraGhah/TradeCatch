/**
 * Shared plumbing for the Bland agent's endpoints (/api/bland/*).
 *
 * Bland's custom tools run on Bland's servers and send whatever headers the
 * tool was configured with. Trust works like this:
 *
 *  - a per-line bearer token (never the general ops secret) proves the caller
 *    is the tool set up for one specific Bland number;
 *  - that number, sent by Bland as the `{{to}}` system variable, picks the
 *    business from the trusted line registry (lines.ts), and the token has to
 *    be that line's own, so one line's token can never act for another;
 *  - what the model supplied (times, names, an address) is validated and
 *    bounded by the same schemas as the other voice agents; the caller's
 *    number comes from Bland's `{{phone_number}}`, not from the model.
 *
 * Everything after that is the shared receptionist code: availability, booking,
 * appointment changes and the call report are the same services the LiveKit
 * agent uses, so a rule is only ever written once.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforcePolicy } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import {
  agentFailureResponse,
  digits,
  MAX_AGENT_BODY_BYTES,
} from "../agent-api";
import { CallOwnershipError } from "../agent-calls";
import { buildBlandConfig } from "./config";
import { dropUnresolved } from "./schemas";
import {
  bearerToken,
  findBlandLine,
  loadBlandLines,
  verifyBlandToken,
  type BlandLine,
} from "./lines";
import { getReceptionistRuntime } from "../runtime";
import type { ReceptionistConfig } from "../types";

type Runtime = ReturnType<typeof getReceptionistRuntime>;

export type BlandRequestContext<S extends z.ZodType> = {
  config: ReceptionistConfig;
  body: z.infer<S>;
  runtime: Runtime;
  line: BlandLine;
};

const noStore = { "Cache-Control": "no-store" };

function reject(
  operation: string,
  reason: "no_token" | "unknown_line" | "bad_token",
): Response {
  // Reason codes only: never the token, the number or the body.
  console.warn(
    JSON.stringify({ event: "tradecatch.bland.rejected", operation, reason }),
  );
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: noStore },
  );
}

/**
 * The line this request is allowed to act for. An unknown number and a wrong
 * token get the same answer, so the endpoint does not say which numbers exist.
 */
function authenticate(
  request: Request,
  operation: string,
  number: string | undefined | null,
): { line: BlandLine } | { response: Response } {
  const token = bearerToken(request.headers.get("authorization"));
  const line = findBlandLine(loadBlandLines(), number ?? undefined);
  if (!verifyBlandToken(line, token)) {
    return {
      response: reject(
        operation,
        !token ? "no_token" : line ? "bad_token" : "unknown_line",
      ),
    };
  }
  return { line: line as BlandLine };
}

async function resolveConfig(
  runtime: Runtime,
  line: BlandLine,
): Promise<ReceptionistConfig | undefined> {
  await runtime.refresh(false);
  // Exact match on the receptionist number the registry names: a line is
  // never answered as some other business.
  return runtime.configs.find(
    (c) =>
      c.enabled &&
      digits(c.phoneNumberE164) === digits(line.receptionistNumber),
  );
}

export async function handleBlandRequest<S extends z.ZodType>(
  request: NextRequest,
  operation: string,
  schema: S,
  run: (ctx: BlandRequestContext<S>) => Promise<unknown>,
): Promise<Response> {
  // Read before authenticating (the line comes from the body), so the size is
  // enforced as the bytes arrive, not after a chunked body was buffered whole.
  const read = await readJsonBody(request, MAX_AGENT_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json({ error: read.error }, { status: read.status });
  }
  const json = read.data;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const raw = dropUnresolved(json as Record<string, unknown>);

  const auth = authenticate(
    request,
    operation,
    typeof raw.number === "string" ? raw.number : undefined,
  );
  if ("response" in auth) return auth.response;
  const { line } = auth;

  const limited = await enforcePolicy("tools.bland-line", {
    subject: line.number,
  });
  if (limited) return limited;

  const runtime = getReceptionistRuntime();
  const config = await resolveConfig(runtime, line);
  if (!config) {
    return NextResponse.json(
      { error: "No active receptionist for that line." },
      { status: 404, headers: noStore },
    );
  }

  // Bland does not always know the language: fall back to the business's own.
  const language =
    raw.language === "fr" || raw.language === "en"
      ? config.languages.includes(raw.language)
        ? raw.language
        : config.defaultLanguage
      : config.defaultLanguage;

  const parsed = schema.safeParse({ ...raw, language });
  if (!parsed.success) {
    // Field names only: the values may be caller speech.
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: Array.from(
          new Set(parsed.error.issues.map((i) => i.path.join("."))),
        ),
      },
      { status: 400, headers: noStore },
    );
  }
  const body = parsed.data as z.infer<S> & { callId: string };

  try {
    const result = await run({ config, body, runtime, line });
    return NextResponse.json(
      { ok: true, ...(result as object) },
      { headers: noStore },
    );
  } catch (err) {
    if (err instanceof CallOwnershipError) {
      return NextResponse.json(
        { error: "That call belongs to another line." },
        { status: 409, headers: noStore },
      );
    }
    return agentFailureResponse(operation, body.callId, err, "bland");
  }
}

/**
 * Call-start data for one line, fetched by Bland (an inbound number's
 * `dynamic_data` request) with the dialed number and the caller's number.
 */
export async function handleBlandConfig(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const number = params.get("number") ?? params.get("to");
  const auth = authenticate(request, "config", number);
  if ("response" in auth) return auth.response;
  const { line } = auth;

  const limited = await enforcePolicy("tools.bland-line", {
    subject: line.number,
  });
  if (limited) return limited;

  const runtime = getReceptionistRuntime();
  const config = await resolveConfig(runtime, line);
  // Profiles are cached for ~30 s: a business that just switched its
  // receptionist off is confirmed against the database on every call.
  const stillOn = config ? await runtime.confirmLineActive(config) : false;
  if (!config || !stillOn) {
    const off = await runtime.describeInactiveLine(line.receptionistNumber);
    if (off) {
      return NextResponse.json(
        {
          ok: true,
          answering: false,
          reason: off.reason,
          callerPolicy: {
            kind: "receptionist_off",
            messages: off.notice.map((l) => ({ lang: l.lang, text: l.text })),
          },
        },
        { headers: noStore },
      );
    }
    return NextResponse.json(
      { error: "No active receptionist for that line." },
      { status: 404, headers: noStore },
    );
  }

  const built = buildBlandConfig(config, {
    line,
    now: new Date(),
    from: params.get("from"),
    bookingProvider: await runtime.bookingProvider(config),
  });
  if (built.transfer.rejected.length > 0 || built.line.smsConflict) {
    // Which settings are wrong, never their values: the owner or support fixes them.
    console.warn(
      JSON.stringify({
        event: "tradecatch.bland.config_issue",
        configId: config.id,
        transferRejected: built.transfer.rejected,
        smsConflict: built.line.smsConflict,
      }),
    );
  }
  return NextResponse.json(
    { ok: true, answering: true, config: built },
    { headers: noStore },
  );
}
