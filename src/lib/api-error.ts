import { NextResponse } from "next/server";
import { reportError } from "./errors";

/**
 * Errors that reach a client must say what the person can act on, never what
 * the server is made of: a Postgres error names tables and hosts, a stack names
 * files. These helpers keep the detail in server logs and the monitor, and give
 * the client a request ID that support can look up.
 */

/** Domain errors whose message is written for the user and which carry their own HTTP status. */
export type PublicErrorClass = abstract new (
  ...args: never[]
) => Error & { status: number };

export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

/**
 * Logs the real error (with stack) for operators and forwards it to the error
 * monitor. Returns the request ID to show the client.
 */
export async function recordServerError(
  error: unknown,
  context: { route: string; request?: Request },
): Promise<string> {
  const requestId = newRequestId();
  const detail = error instanceof Error ? error : new Error(String(error));
  console.error(
    `[api-error] ${requestId} ${context.route}`,
    JSON.stringify({
      requestId,
      route: context.route,
      method: context.request?.method,
      cfRay: context.request?.headers.get("cf-ray") ?? undefined,
      name: detail.name,
      message: detail.message,
    }),
    detail.stack,
  );
  await reportError(detail, { route: context.route, requestId });
  return requestId;
}

export async function safeErrorResponse(
  error: unknown,
  options: {
    route: string;
    request?: Request;
    /** Domain errors that are safe to show as they are, with their own status. */
    publicErrors?: PublicErrorClass[];
    fallback?: string;
  },
): Promise<NextResponse> {
  if (options.publicErrors?.some((Known) => error instanceof Known)) {
    const known = error as Error & { status: number };
    return NextResponse.json(
      { error: known.message },
      { status: known.status },
    );
  }
  const requestId = await recordServerError(error, options);
  return NextResponse.json(
    {
      error: options.fallback ?? "Something went wrong. Please try again.",
      requestId,
    },
    {
      status: 500,
      headers: { "x-request-id": requestId, "Cache-Control": "no-store" },
    },
  );
}
