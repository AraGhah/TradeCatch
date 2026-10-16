import { getReliabilityService } from "./runtime";

export async function recordFailure(input: {
  organizationId?: string;
  service: string;
  operation: string;
  errorCode: string;
  severity?: "low" | "medium" | "high" | "critical";
  retryable?: boolean;
  detail?: string;
  simulated?: boolean;
}) {
  try {
    await getReliabilityService().recordError({
      ...input,
      severity: input.severity ?? "high",
      retryable: input.retryable ?? true,
    });
  } catch (error) {
    console.warn("[reliability] record skipped", error instanceof Error ? error.message : "unknown");
  }
}
