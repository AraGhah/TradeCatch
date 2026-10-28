/** Never log provider bodies, database URLs, transcripts or recording URLs. */
export function receptionistErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  const code = (error as Error & { code?: unknown }).code;
  if (
    typeof code === "string" &&
    (/^[0-9A-Z]{5}$/.test(code) ||
      [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EPIPE",
      ].includes(code))
  )
    return code;
  if (/different request|I\/O.*context|request.*I\/O/i.test(error.message))
    return "WORKER_IO_CONTEXT";
  if (/requires DATABASE_URL/.test(error.message))
    return "DATABASE_URL_MISSING";
  if (/Refusing in-memory/.test(error.message)) return "DURABLE_STORE_REQUIRED";
  if (
    /Invalid config|Invalid production config|not valid JSON/.test(
      error.message,
    )
  )
    return "INVALID_CONFIGURATION";
  return "UNKNOWN";
}

type Diagnostic = {
  event:
    | "incoming_declined"
    | "profiles_loaded"
    | "profile_skipped"
    | "profile_reload_failed"
    | "runtime_unavailable"
    | "webhook_failed"
    | "orphan_voicemail"
    | "call_event_write_failed"
    | "status_finalize_failed";
  code?: string;
  callSid?: string;
  step?: string;
  organizationId?: string;
  dialedNumber?: string;
  profiles?: number;
  enabledProfiles?: number;
  error?: unknown;
};

export function logReceptionistDiagnostic(input: Diagnostic): void {
  const { error, dialedNumber, callSid, organizationId, ...fields } = input;
  const safeId = (id?: string) =>
    id && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : undefined;
  const entry = {
    ...fields,
    event: `tradecatch.receptionist.${input.event}`,
    callSid: safeId(callSid),
    organizationId: safeId(organizationId),
    dialedNumberLast4: dialedNumber?.replace(/\D/g, "").slice(-4) || undefined,
    ...(error === undefined ? {} : { errorCode: receptionistErrorCode(error) }),
  };
  const line = JSON.stringify(entry);
  if (input.event === "profiles_loaded") console.info(line);
  else console.error(line);
}
