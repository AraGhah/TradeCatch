import type { GmailFailureKind } from "./types";

export class GmailApiError extends Error {
  constructor(
    readonly kind: GmailFailureKind,
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3600) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 3_600_000) : undefined;
}

/**
 * Maps a Google response (Gmail API or OAuth token endpoint) onto what the
 * user can actually do about it. `needs_reconnect` is reserved for failures a
 * new consent can fix; everything operator-fixable is `config_error`.
 */
export function failureFromResponse(
  status: number,
  text: string,
  retryAfter?: string | null,
): GmailApiError {
  let reason = "";
  let message = text.slice(0, 300);
  try {
    const json = JSON.parse(text) as {
      error?: string | { errors?: { reason?: string }[]; status?: string; message?: string };
      error_description?: string;
    };
    if (typeof json.error === "string") {
      reason = json.error;
      message = json.error_description || json.error;
    } else if (json.error) {
      reason = json.error.errors?.[0]?.reason || json.error.status || "";
      message = json.error.message || message;
    }
  } catch {
    // Non-JSON body (proxy error page, truncated response): fall through on status.
  }
  const haystack = `${reason} ${message}`.toLowerCase();
  const retryAfterMs = parseRetryAfter(retryAfter);

  if (/invalid_grant|invalid_token|unauthorized_client/.test(haystack) || status === 401) {
    return new GmailApiError("needs_reconnect", status, message);
  }
  if (status === 403 && /insufficient/.test(haystack)) {
    return new GmailApiError("needs_reconnect", status, message);
  }
  if (
    status === 429 ||
    /ratelimitexceeded|userratelimitexceeded|quotaexceeded|rate limit/.test(haystack)
  ) {
    return new GmailApiError("rate_limited", status, message, retryAfterMs);
  }
  if (
    /invalid_client|redirect_uri_mismatch|accessnotconfigured|service_disabled|has not been used|is disabled/.test(
      haystack,
    )
  ) {
    return new GmailApiError("config_error", status, message);
  }
  return new GmailApiError("sync_failed", status, message);
}

export function toGmailError(error: unknown): GmailApiError {
  if (error instanceof GmailApiError) return error;
  const message = error instanceof Error ? error.message : "unknown";
  return new GmailApiError("sync_failed", 0, message);
}

const MINUTE = 60_000;

/** How long to leave an account alone after a failure. */
export function backoffMs(error: GmailApiError, failures: number): number {
  switch (error.kind) {
    case "needs_reconnect":
      return 0;
    case "rate_limited":
      return Math.max(error.retryAfterMs ?? 0, 5 * MINUTE);
    case "config_error":
      return 60 * MINUTE;
    default:
      return Math.min(30 * MINUTE, MINUTE * 2 ** Math.max(0, Math.min(failures, 10) - 1));
  }
}
