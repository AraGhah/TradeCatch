const SECRET = /(?:sk_(?:live|test)_[A-Za-z0-9]+|Bearer\s+\S+|ya29\.[A-Za-z0-9._-]+|AKIA[0-9A-Z]{16}|whsec_[A-Za-z0-9]+)/gi;

export function redactDiagnostic(value: string): string {
  return value.replace(SECRET, "[redacted]").replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted]").slice(0, 300);
}

export type ServiceName =
  | "api"
  | "database"
  | "ai_receptionist"
  | "twilio_voice"
  | "twilio_sms"
  | "google_calendar"
  | "stripe"
  | "jobs"
  | "notifications";

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";
export type Severity = "low" | "medium" | "high" | "critical";

export type SystemError = {
  id: string;
  requestId: string;
  organizationId?: string;
  service: string;
  operation: string;
  errorCode: string;
  severity: Severity;
  retryable: boolean;
  attemptCount: number;
  status: "open" | "investigating" | "resolved";
  detail?: string;
  environment: string;
  simulated: boolean;
  createdAt: string;
};

export type Incident = {
  id: string;
  organizationId?: string;
  service: string;
  severity: Severity;
  title: string;
  status: "open" | "investigating" | "resolved";
  correlationId: string;
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
};

export type FailedOperation = {
  id: string;
  organizationId?: string;
  service: string;
  operation: string;
  idempotencyKey: string;
  status: "failed" | "retrying" | "resolved" | "dead";
  retryable: boolean;
  attempts: number;
  lastError?: string;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FallbackSettings = {
  organizationId: string;
  aiUnavailable: "transfer" | "voicemail";
  calendarUnavailable: "collect_request";
  databaseUnavailable: "do_not_claim_saved";
  transferFailed: "voicemail" | "backup";
  updatedAt: string;
};

export type ServiceHealth = {
  service: ServiceName;
  status: HealthStatus;
  checkedAt: string;
  detail?: string;
  required: boolean;
};
