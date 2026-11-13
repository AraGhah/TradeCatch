/**
 * Last-resort handler for an exception that escapes the Worker's `fetch` path.
 *
 * Without it Cloudflare answers with its own raw "error code: 1101" page and
 * the application records nothing about which route failed. This logs one
 * structured event and returns a short, retryable 503.
 *
 * It does not hide anything: responses the app itself produced (including 4xx
 * and 5xx) pass through untouched, and the failure is always logged. It also
 * cannot recover an isolate that Cloudflare kills for exceeding its resource
 * limits (Error 1102); that happens outside the script. See
 * docs/WORKER_MEMORY.md for how that failure is prevented and detected.
 */

const RETRY_AFTER_SECONDS = "5";
const MAX_LOGGED_MESSAGE = 200;

/** Drops credentials that a driver or SDK message may quote, e.g. postgres://user:secret@host. */
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/:\/\/[^\s/@]+@/g, "://[redacted]@")
    .slice(0, MAX_LOGGED_MESSAGE);
}

function unavailableResponse(request: Request, path: string): Response {
  const headers = {
    "Cache-Control": "no-store",
    "Retry-After": RETRY_AFTER_SECONDS,
  };
  if (path.startsWith("/api/"))
    return Response.json(
      { error: "service_unavailable", retryable: true },
      { status: 503, headers },
    );
  const body =
    request.method === "HEAD"
      ? null
      : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>TradeCatch</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1>TradeCatch is briefly unavailable</h1><p>Please try again in a few seconds.</p><p lang="fr">TradeCatch est momentan&eacute;ment indisponible. Veuillez r&eacute;essayer dans quelques secondes.</p></body></html>`;
  return new Response(body, {
    status: 503,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function guardWorkerFetch(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    // Path only: query strings can carry one-time sign-in tokens.
    const path = new URL(request.url).pathname;
    console.error(
      JSON.stringify({
        event: "tradecatch.worker.fetch_failed",
        method: request.method,
        path,
        error: error instanceof Error ? error.name : "UnknownError",
        message: safeErrorMessage(error),
      }),
    );
    return unavailableResponse(request, path);
  }
}
