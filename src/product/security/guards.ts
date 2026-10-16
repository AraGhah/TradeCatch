const CROSS_CUSTOMER = /another customer|autre client|other customer'?s|ignore (all |your )?(previous |prior )?instructions|ignore tes instructions/i;

export function authorizeAiTool(input: {
  organizationId: string;
  requestedOrganizationId?: string;
  utterance: string;
  tool: string;
}): { ok: true } | { ok: false; reason: "cross_business" | "untrusted_instruction" } {
  if (input.requestedOrganizationId && input.requestedOrganizationId !== input.organizationId) {
    return { ok: false, reason: "cross_business" };
  }
  if (CROSS_CUSTOMER.test(input.utterance) && /customer|client|appointment|rendez|instruction|prompt|secret/i.test(input.utterance)) {
    return { ok: false, reason: "untrusted_instruction" };
  }
  if (input.tool === "read_other_business") return { ok: false, reason: "cross_business" };
  return { ok: true };
}

export function recordingDecision(input: {
  recordingEnabled: boolean;
  consent: "granted" | "denied" | "unknown";
  onDenied: "continue_without_recording" | "end_call";
}): { record: boolean; endCall: boolean } {
  if (!input.recordingEnabled || input.consent !== "granted") {
    return { record: false, endCall: input.consent === "denied" && input.onDenied === "end_call" };
  }
  return { record: true, endCall: false };
}
