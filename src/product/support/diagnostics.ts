import type { PlanId } from "@/product/saas/entitlements";
import { orgHasFeature } from "@/product/saas/entitlements";
import { SupportError } from "./errors";
import type { DiagnosticCheck, DiagnosticFinding } from "./types";

const CODES_BY_CHECK: Record<Exclude<DiagnosticCheck, "all">, string[]> = {
  ai: ["plan", "phone_missing"],
  phone: ["phone_missing"],
  calendar: ["calendar_disconnected"],
  notifications: [],
  sms: ["sms_unconfigured"],
  automations: ["automation_off"],
  subscription: ["plan"],
};

export function diagnoseConfiguration(input: {
  plan: PlanId;
  phone?: string | null;
  calendarConnected: boolean;
  automationEnabled: boolean;
  smsConfigured: boolean;
}) {
  const findings: DiagnosticFinding[] = [];
  if (!orgHasFeature(input.plan, "MISSED_CALL_RECOVERY")) {
    findings.push({ code: "plan", articleId: "billing", detail: "This plan does not include the AI receptionist." });
  }
  if (!input.phone) findings.push({ code: "phone_missing", articleId: "phone", detail: "No business number is assigned." });
  if (!input.calendarConnected) {
    findings.push({ code: "calendar_disconnected", articleId: "calendar", detail: "Google Calendar is not connected. Appointments cannot be confirmed." });
  }
  if (!input.automationEnabled) findings.push({ code: "automation_off", articleId: "automations", detail: "Missed-call recovery is not enabled." });
  if (!input.smsConfigured) findings.push({ code: "sms_unconfigured", articleId: "sms", detail: "Messaging is not configured." });
  return { scope: "configuration" as const, liveVerified: false as const, findings };
}

export function findingsForCheck(check: DiagnosticCheck, findings: DiagnosticFinding[]) {
  if (check === "all") return findings;
  const allowed = new Set(CODES_BY_CHECK[check]);
  return findings.filter((finding) => allowed.has(finding.code));
}

export async function diagnosticSnapshot(organizationId: string) {
  const { getSaasStore } = await import("@/product/saas/runtime");
  const org = await getSaasStore().getOrganization(organizationId);
  if (!org) throw new SupportError("Business not found.", 404);
  const calendarConnected = await readCalendarConnected(organizationId);
  const automationEnabled = await readAutomationEnabled(organizationId);
  const recentErrorCount = await readRecentErrorCount(organizationId);
  const report = diagnoseConfiguration({
    plan: org.plan,
    phone: org.phoneE164,
    calendarConnected,
    automationEnabled,
    smsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  });
  return { ...report, plan: org.plan, recentErrorCount };
}

async function readCalendarConnected(organizationId: string) {
  try {
    const { getSchedulingService } = await import("@/product/scheduling/runtime");
    const status = await getSchedulingService().connectionStatus(organizationId);
    return status.status === "connected";
  } catch {
    return false;
  }
}

async function readAutomationEnabled(organizationId: string) {
  try {
    const { getAutomationStore } = await import("@/product/sms-automation/runtime");
    const rows = await getAutomationStore().listAutomations(organizationId);
    return rows.some((row) => row.enabled);
  } catch {
    return false;
  }
}

async function readRecentErrorCount(organizationId: string) {
  try {
    const { getReliabilityService } = await import("@/product/reliability/runtime");
    return (await getReliabilityService().listErrors({ organizationId })).length;
  } catch {
    return 0;
  }
}
