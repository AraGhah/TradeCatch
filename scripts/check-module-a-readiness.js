#!/usr/bin/env node
/**
 * Founder go-live readiness for Module A (Voie A / pilot).
 * Usage: node scripts/check-module-a-readiness.js
 * Exit 0 when all required env checks pass; 1 otherwise.
 */
const required = [
  ["DATABASE_URL", "Postgres connection string"],
  ["MISSED_CALL_DURABLE_STORE", "Must be 1"],
  ["TWILIO_ACCOUNT_SID", "Twilio account"],
  ["TWILIO_AUTH_TOKEN", "Twilio auth token"],
  ["MISSED_CALL_OPS_SECRET", "Ops/cron bearer (or CRON_SECRET)"],
  ["MISSED_CALL_PUBLIC_WEBHOOK_BASE", "Public HTTPS origin for Twilio signatures"],
];

const recommended = [
  ["MISSED_CALL_CLIENT_CONFIG_JSON", "Full client JSON (preferred over piecemeal env)"],
  ["AUTH_SECRET", "Pilot portal session signing"],
  ["RESEND_API_KEY", "Magic-link + book-audit email"],
  ["ERROR_WEBHOOK_URL", "Error forwarding"],
  ["UPSTASH_REDIS_REST_URL", "Shared rate limits under multi-instance"],
];

function present(key) {
  if (key === "MISSED_CALL_OPS_SECRET") {
    return Boolean(
      process.env.MISSED_CALL_OPS_SECRET?.trim() ||
        process.env.CRON_SECRET?.trim(),
    );
  }
  if (key === "MISSED_CALL_DURABLE_STORE") {
    return process.env.MISSED_CALL_DURABLE_STORE === "1";
  }
  return Boolean(process.env[key]?.trim());
}

const missing = required.filter(([key]) => !present(key));
const missingRecommended = recommended.filter(([key]) => !present(key));

console.log("TradeCatch Module A readiness (founder pilot)\n");

if (missing.length === 0) {
  console.log("Required: OK");
} else {
  console.log("Required: MISSING");
  for (const [key, why] of missing) {
    console.log(`  - ${key} — ${why}`);
  }
}

if (missingRecommended.length === 0) {
  console.log("Recommended: OK");
} else {
  console.log("Recommended: incomplete");
  for (const [key, why] of missingRecommended) {
    console.log(`  - ${key} — ${why}`);
  }
}

console.log(`
Manual Twilio Console checks (not auto-verified):
  1. Advanced Opt-Out enabled on the Messaging Service / number
  2. Voice status + SMS inbound + SMS status webhooks point at this host
  3. Escalation cron hits /api/missed-call/escalations/tick every minute
  4. No demo/555 numbers in production client config
  5. Staging: missed call → SMS → collect → ACCEPTER → customer notify
`);

process.exit(missing.length === 0 ? 0 : 1);
