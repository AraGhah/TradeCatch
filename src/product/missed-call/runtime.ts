import { createMissedCallEngine, type MissedCallEngine } from "./engine";
import { demoClientAccount } from "./fixtures";
import { createMemoryStore, type MissedCallStore } from "./store";
import { createTwilioSmsPort } from "./twilio";

/**
 * Process-local singleton for Module A.
 * Replace createMemoryStore with a durable DB adapter before multi-instance production.
 */
const globalForMissedCall = globalThis as unknown as {
  __tradecatchMissedCall?: {
    store: MissedCallStore;
    engine: MissedCallEngine;
    ready: Promise<void>;
  };
};

function bootstrap() {
  const store = createMemoryStore();
  const clientId =
    process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo";
  const smsFrom =
    process.env.MISSED_CALL_SMS_FROM?.trim() || "+15145550100";
  const techPhone =
    process.env.MISSED_CALL_TECH_PHONE?.trim() || "+15145550199";
  const contractor =
    process.env.MISSED_CALL_CONTRACTOR_NAME?.trim() || "Nord Plomberie";
  const techName =
    process.env.MISSED_CALL_TECH_NAME?.trim() || "Technicien de garde";

  const base = demoClientAccount({
    id: clientId,
    smsFromNumber: smsFrom,
    contractorDisplayName: contractor,
    name: contractor,
  });

  if (techPhone !== "+15145550199") {
    base.technicianRoster = base.technicianRoster.map((t) =>
      t.role === "primary" ? { ...t, phone: techPhone, name: techName } : t,
    );
    base.onCallTechnicians = [
      { id: base.mainTechnicianId, name: techName, phone: techPhone, active: true },
    ];
  }

  const ready = store.saveClient(base);

  const engine = createMissedCallEngine({
    store,
    sms: createTwilioSmsPort(),
  });

  return { store, engine, ready };
}

export function getMissedCallRuntime() {
  if (!globalForMissedCall.__tradecatchMissedCall) {
    globalForMissedCall.__tradecatchMissedCall = bootstrap();
  }
  return globalForMissedCall.__tradecatchMissedCall;
}

export async function ensureMissedCallReady() {
  const runtime = getMissedCallRuntime();
  await runtime.ready;
  return runtime;
}
