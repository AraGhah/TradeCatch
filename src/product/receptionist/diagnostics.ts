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
    | "status_finalize_failed"
    | "webhook_phase_entered"
    | "webhook_completed"
    | "refresh_skipped_in_flight";
  code?: string;
  callSid?: string;
  step?: string;
  phase?: string;
  organizationId?: string;
  dialedNumber?: string;
  profiles?: number;
  enabledProfiles?: number;
  /** Wall-clock time this phase/request took, for pinpointing a hang's
   * last-reached phase without logging anything that could itself hang. */
  durationMs?: number;
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
  const infoLevel: Diagnostic["event"][] = [
    "profiles_loaded",
    "webhook_completed",
    "webhook_phase_entered",
    "refresh_skipped_in_flight",
  ];
  if (infoLevel.includes(input.event)) console.info(line);
  else console.error(line);
}

/**
 * Opt-in, per-phase "entered this await" markers for diagnosing a hang:
 * when a request never completes, the last phase logged here (and nothing
 * after it) names exactly which awaited operation never returned — a plain
 * try/catch around the operation cannot do this, since a genuine runtime
 * hang never reaches the catch or finally block either.
 * Off by default (RECEPTIONIST_TIMING_DIAGNOSTICS=1 to enable) since it
 * logs once per phase per webhook call.
 */
export function timingDiagnosticsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.RECEPTIONIST_TIMING_DIAGNOSTICS === "1";
}

export function logWebhookPhaseEntered(input: {
  step: string;
  phase: string;
  callSid?: string;
}): void {
  if (!timingDiagnosticsEnabled()) return;
  logReceptionistDiagnostic({ event: "webhook_phase_entered", ...input });
}
