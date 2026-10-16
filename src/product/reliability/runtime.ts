import { isTwilioConfigured } from "@/lib/config";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { createPostgresReliabilityStore } from "./postgres-store";
import { createReliabilityService, type Probe } from "./service";
import { createMemoryReliabilityStore, type ReliabilityStore } from "./store";
import type { ServiceName } from "./types";

const globalForReliability = globalThis as unknown as { __tradecatchReliability?: ReliabilityStore };

function store(): ReliabilityStore {
  if (!globalForReliability.__tradecatchReliability) {
    const url = process.env.DATABASE_URL?.trim();
    const durable = process.env.MISSED_CALL_DURABLE_STORE === "1" || process.env.SAAS_DURABLE_STORE === "1";
    globalForReliability.__tradecatchReliability = durable && url ? createPostgresReliabilityStore(url) : createMemoryReliabilityStore();
  }
  return globalForReliability.__tradecatchReliability;
}

async function probe(): Promise<Probe[]> {
  const probes: Probe[] = [{ service: "api", status: "healthy", detail: "process responding" }];
  const url = process.env.DATABASE_URL?.trim();
  if (!url) probes.push({ service: "database", status: "unknown", detail: "DATABASE_URL is not set" });
  else {
    try {
      await getPgPool(url).query("SELECT 1");
      probes.push({ service: "database", status: "healthy", detail: "SELECT 1" });
    } catch {
      probes.push({ service: "database", status: "unavailable", detail: "required query failed" });
    }
  }
  const ai = Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
  probes.push({ service: "ai_receptionist", status: ai ? "healthy" : "unknown", detail: ai ? "provider key present" : "provider key not configured" });
  probes.push({ service: "twilio_voice", status: isTwilioConfigured() ? "healthy" : "unknown", detail: "configuration only" });
  probes.push({ service: "twilio_sms", status: isTwilioConfigured() ? "healthy" : "unknown", detail: "configuration only" });
  const calendar = Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim());
  probes.push({ service: "google_calendar", status: calendar ? "healthy" : "unknown", detail: calendar ? "oauth client configured" : "not configured" });
  const stripe = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  probes.push({ service: "stripe", status: stripe ? "healthy" : "unknown", detail: stripe ? "secret present" : "not configured" });
  const checks = await store().listHealth();
  const tick = [...checks].reverse().find((row) => row.service === "scheduler_tick");
  const fresh = Boolean(tick && Date.parse(tick.checkedAt) > Date.now() - 20 * 60_000);
  probes.push({
    service: "jobs",
    status: fresh ? "healthy" : "unknown",
    detail: fresh ? "scheduler tick recorded" : "no recent scheduler tick",
  });
  probes.push({ service: "notifications", status: "healthy", detail: "notification processor configured" });
  return probes;
}

export function getReliabilityService() {
  return createReliabilityService({
    store: store(),
    now: () => new Date(),
    environment: () => process.env.TRADECATCH_ENV?.trim() || process.env.NODE_ENV || "development",
    probe,
    version: () => process.env.TRADECATCH_VERSION?.trim() || "0.1.0",
    async notifyAdmin(input) {
      if (input.simulated) return;
      const to = process.env.ADMIN_ALERT_EMAIL?.trim();
      if (!to) return;
      const { sendBusinessNotifyEmail } = await import("@/lib/business-notifications");
      await sendBusinessNotifyEmail({
        toEmail: to,
        subject: `TradeCatch incident: ${input.title}`,
        title: input.title,
        lines: [{ label: "Severity", value: input.severity }],
      });
    },
  });
}

export function resetReliabilityRuntimeForTests() {
  delete globalForReliability.__tradecatchReliability;
}

export type { ServiceName };
