#!/usr/bin/env node
/**
 * Founder go-live readiness for Module A (Voie A / pilot).
 * Loads the same local environment files as Next.js and never prints values.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  loadClientAccountFromEnv,
  validateClientConfig,
} from "../src/product/missed-call/client-config";
import { getProductionSafetyIssues } from "../src/lib/production-safety";

const ROOT = path.join(import.meta.dirname, "..");
loadEnvConfig(ROOT, process.env.NODE_ENV !== "production");

type Check = {
  label: string;
  why: string;
  valid: () => boolean;
};

function has(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function isHttpsOrigin(value: string | undefined): boolean {
  try {
    const url = new URL(value || "");
    return (
      url.protocol === "https:" && url.origin === value?.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

const required: Check[] = [
  {
    label: "DATABASE_URL",
    why: "Postgres connection string",
    valid: () => has("DATABASE_URL"),
  },
  {
    label: "MISSED_CALL_DURABLE_STORE",
    why: "Must be 1",
    valid: () => process.env.MISSED_CALL_DURABLE_STORE === "1",
  },
  {
    label: "TWILIO_ACCOUNT_SID",
    why: "Twilio account",
    valid: () => has("TWILIO_ACCOUNT_SID"),
  },
  {
    label: "TWILIO_AUTH_TOKEN",
    why: "Twilio auth token",
    valid: () => has("TWILIO_AUTH_TOKEN"),
  },
  {
    label: "MISSED_CALL_OPS_SECRET / CRON_SECRET",
    why: "Ops and scheduler bearer",
    valid: () => has("MISSED_CALL_OPS_SECRET") || has("CRON_SECRET"),
  },
  {
    label: "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
    why: "Must be the public HTTPS origin used for Twilio signatures",
    valid: () => isHttpsOrigin(process.env.MISSED_CALL_PUBLIC_WEBHOOK_BASE),
  },
  {
    label: "CF_TRUSTED",
    why: "Must be 1 so Cloudflare client IPs receive independent rate limits",
    valid: () => process.env.CF_TRUSTED === "1",
  },
];

const recommended: Check[] = [
  {
    label: "AUTH_SECRET",
    why: "Pilot portal session signing",
    valid: () => has("AUTH_SECRET"),
  },
  {
    label: "RESEND_API_KEY",
    why: "Magic-link and book-audit email",
    valid: () => has("RESEND_API_KEY"),
  },
  {
    label: "ERROR_WEBHOOK_URL",
    why: "Error forwarding",
    valid: () => has("ERROR_WEBHOOK_URL"),
  },
  {
    label: "UPSTASH_REDIS_REST_URL + TOKEN",
    why: "Shared rate limits under multiple instances",
    valid: () =>
      has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
  },
];

function clientConfigurationErrors(): string[] {
  try {
    const productionEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      MISSED_CALL_ALLOW_DEMO: undefined,
    };
    const { client } = loadClientAccountFromEnv(productionEnv);
    return validateClientConfig(client).errors;
  } catch (error) {
    return [error instanceof Error ? error.message : "invalid client config"];
  }
}

function schedulerConfigurationErrors(): string[] {
  const config = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  const expected = ["* * * * *", "*/15 * * * *", "15 6 * * *"];
  return expected
    .filter((cron) => !config.includes(`\"${cron}\"`))
    .map((cron) => `wrangler.jsonc is missing cron ${cron}`);
}

const missing = required.filter((check) => !check.valid());
const missingRecommended = recommended.filter((check) => !check.valid());
const clientErrors = clientConfigurationErrors();
const schedulerErrors = schedulerConfigurationErrors();
const safetyIssues = getProductionSafetyIssues();

console.log("TradeCatch Module A readiness (founder pilot)\n");

if (missing.length === 0) {
  console.log("Required environment: OK");
} else {
  console.log("Required environment: MISSING");
  for (const check of missing) {
    console.log(`  - ${check.label} - ${check.why}`);
  }
}

if (clientErrors.length === 0) {
  console.log("Client routing configuration: OK");
} else {
  console.log("Client routing configuration: INVALID");
  for (const error of clientErrors) console.log(`  - ${error}`);
}

if (schedulerErrors.length === 0) {
  console.log("Cloudflare cron declarations: OK");
} else {
  console.log("Cloudflare cron declarations: INVALID");
  for (const error of schedulerErrors) console.log(`  - ${error}`);
}

if (safetyIssues.length === 0) {
  console.log("Production safety flags: OK");
} else {
  console.log("Production safety flags: UNSAFE");
  for (const issue of safetyIssues) {
    console.log(`  - ${issue.key} - ${issue.message}`);
  }
}

if (missingRecommended.length === 0) {
  console.log("Recommended environment: OK");
} else {
  console.log("Recommended environment: incomplete");
  for (const check of missingRecommended) {
    console.log(`  - ${check.label} - ${check.why}`);
  }
}

console.log(`
Manual provider checks (not auto-verified):
  1. Run npm run db:schema and verify backup/restore access
  2. Enable Twilio Advanced Opt-Out on the Messaging Service or number
  3. Point voice status, SMS inbound, and SMS status webhooks at this host
  4. Confirm Cloudflare deployed all three cron triggers and the ops secret
  5. Run: missed call -> SMS -> collect -> ACCEPTER -> customer notification
`);

const blocked =
  missing.length > 0 ||
  clientErrors.length > 0 ||
  schedulerErrors.length > 0 ||
  safetyIssues.length > 0;
process.exit(blocked ? 1 : 0);
