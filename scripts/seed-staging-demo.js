#!/usr/bin/env node
/**
 * Seed (or re-seed) the staging demo missed-call client into DATABASE_URL.
 *
 * Usage:
 *   TRADECATCH_ENV=staging DATABASE_URL=… MISSED_CALL_DURABLE_STORE=1 npm run db:seed:staging
 *
 * Never point DATABASE_URL at production. This script refuses to run unless
 * TRADECATCH_ENV=staging (or TRADECATCH_ALLOW_DEMO_RESET=1 on a disposable host).
 */
const { Client } = require("pg");

function assertStagingSafe() {
  const envName = (process.env.TRADECATCH_ENV || "").trim().toLowerCase();
  const allow =
    envName === "staging" ||
    envName === "stage" ||
    envName === "demo" ||
    process.env.TRADECATCH_ALLOW_DEMO_RESET === "1";
  if (!allow) {
    console.error(
      "Refusing to seed: set TRADECATCH_ENV=staging (or TRADECATCH_ALLOW_DEMO_RESET=1).",
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL?.trim() || "";
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const lowered = url.toLowerCase();
  if (
    lowered.includes("prod") &&
    process.env.TRADECATCH_ALLOW_DEMO_RESET !== "1"
  ) {
    console.error(
      "DATABASE_URL looks production-like. Refusing seed. Override only with TRADECATCH_ALLOW_DEMO_RESET=1 on a disposable DB.",
    );
    process.exit(1);
  }
}

async function main() {
  assertStagingSafe();
  const url = process.env.DATABASE_URL.trim();
  const clientId = process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo";

  const payload = {
    id: clientId,
    name: "Nord Plumbing Inc. (Staging Demo)",
    contractorDisplayName: "Nord Plomberie (Démo)",
    timezone: process.env.MISSED_CALL_TIMEZONE?.trim() || "America/Toronto",
    businessHours: { start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    approvedServiceAreas: [
      {
        id: "area_laval",
        label: "Laval",
        matchTokens: ["laval", "h7", "h7a", "h7b", "h7g"],
      },
    ],
    urgencyRubric: {
      emergencyKeywords: ["fuite", "leak", "inond"],
      highKeywords: ["pas d'eau", "no water", "chauffe"],
      mediumKeywords: ["drain", "toilette"],
    },
    technicianRoster: [
      {
        id: "tech_marc",
        name: "Marc D.",
        phone: "+15145550199",
        role: "primary",
        active: true,
      },
      {
        id: "tech_sophie",
        name: "Sophie L.",
        phone: "+15145550288",
        role: "backup",
        active: true,
      },
      {
        id: "tech_owner",
        name: "Alex Propriétaire",
        phone: "+15145550377",
        role: "owner",
        active: true,
      },
    ],
    mainTechnicianId: "tech_marc",
    backupTechnicianIds: ["tech_sophie"],
    ownerTechnicianId: "tech_owner",
    onCallSchedule: [],
    escalationPolicy: {
      primaryResponseMs: 5 * 60 * 1000,
      backupResponseMs: 5 * 60 * 1000,
      ownerResponseMs: 10 * 60 * 1000,
    },
    humanReviewPhone: "+15145550377",
    onCallTechnicians: [
      {
        id: "tech_marc",
        name: "Marc D.",
        phone: "+15145550199",
        active: true,
      },
    ],
    approvedQuestions: [],
    smsFromNumber: process.env.MISSED_CALL_SMS_FROM?.trim() || "+15145550100",
    optOutKeywords: ["stop", "arret", "arrêt"],
    duplicateWindowMs: 30 * 60 * 1000,
  };

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query(
      `SELECT to_regclass('public.mc_clients') AS reg`,
    );
    if (!exists.rows[0]?.reg) {
      console.error("mc_clients missing — run npm run db:schema first");
      process.exit(1);
    }

    await client.query(
      `INSERT INTO mc_clients (id, payload, sms_from_e164, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload,
             sms_from_e164 = EXCLUDED.sms_from_e164,
             updated_at = now()`,
      [clientId, JSON.stringify(payload), payload.smsFromNumber],
    );
    console.info(`Seeded staging demo client ${clientId}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
