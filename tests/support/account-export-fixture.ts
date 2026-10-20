import type { Organization } from "../../src/product/saas/types";
import type { CrmStore } from "../../src/product/crm/store";
import type { SchedulingStore } from "../../src/product/scheduling/store";
import type { GrowthStore } from "../../src/product/growth/memory-store";
import type { StarterStore } from "../../src/product/starter/memory-store";
import type { SupportStore } from "../../src/product/support/store";
import type { ReceptionistStore } from "../../src/product/receptionist/store";
import type { MissedCallStore } from "../../src/product/missed-call/store";
import type { CallSession } from "../../src/product/receptionist/types";
import { createCrmService } from "../../src/product/crm/service";
import { newId } from "../../src/product/saas/ids";
export type ExportStores = {
  crm: CrmStore;
  scheduling: SchedulingStore;
  growth: GrowthStore;
  starter: StarterStore;
  support: SupportStore;
  receptionist: ReceptionistStore;
  missed: MissedCallStore;
};
export function installExportStores(stores: ExportStores) {
  const values: Record<string, unknown> = {
    __tradecatchCrm: {
      store: stores.crm,
      service: createCrmService(stores.crm),
      durable: false,
    },
    __tradecatchScheduling: { store: stores.scheduling, durable: false },
    __tradecatchGrowth: { store: stores.growth, durable: false },
    __tradecatchStarter: { store: stores.starter, durable: false },
    __tradecatchSupport: stores.support,
    __tradecatchReceptionist: {
      store: stores.receptionist,
      envConfigs: [],
      profileConfigs: [],
      durable: false,
    },
    __tradecatchMissedCall: {
      store: stores.missed,
      ready: Promise.resolve(),
      durable: false,
    },
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Reflect.get(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(values))
    Reflect.set(globalThis, key, value);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key);
      else Reflect.set(globalThis, key, value);
    }
  };
}
export async function seedExportRecords(
  stores: ExportStores,
  org: Organization,
) {
  const at = new Date().toISOString(),
    id = org.id,
    client = org.missedCallClientId!;
  const crm = createCrmService(stores.crm);
  const captured = await crm.capture({
    organizationId: id,
    source: "manual",
    phoneE164: "+14385550123",
    displayName: "=1+2",
    description: "Export test service request",
    message: {
      direction: "inbound",
      body: "Customer reply",
      deliveryStatus: "delivered",
    },
  });
  await stores.crm.upsertCustomer({
    organizationId: id,
    phoneE164: "+14385550124",
    displayName: "Customer without lead",
    preferredLanguage: "en",
    firstContactAt: at,
    lastContactAt: at,
  });
  await stores.starter.createWebsiteLead({
    organizationId: id,
    phoneE164: "+14385550123",
    name: "Website customer",
    message: "Website request",
    status: "new",
    conversationMode: "auto",
    openingSmsSent: false,
  });
  const quoteId = newId("qt_export");
  await stores.starter.createQuoteThread({
    id: quoteId,
    organizationId: id,
    customerPhoneE164: "+14385550123",
    customerName: "Quote customer",
    quoteSentAt: at,
    locale: "en",
    status: "active",
    conversationMode: "auto",
    nextStepIndex: 0,
    attempts: 0,
    createdAt: at,
    updatedAt: at,
  });
  await stores.starter.addQuoteMessage({
    threadId: quoteId,
    direction: "inbound",
    body: "Quote reply",
    at,
  });
  const appointmentId = newId("apt_export");
  await stores.scheduling.insertIfFree(
    {
      id: appointmentId,
      organizationId: id,
      serviceName: "Export test appointment",
      customerPhoneE164: "+14385550123",
      leadId: captured.lead.id,
      startAt: "2035-01-01T12:00:00Z",
      endAt: "2035-01-01T13:00:00Z",
      timezone: "America/Toronto",
      status: "confirmed",
      bookingSource: "manual",
      appointmentKind: "job",
      simulated: true,
      createdAt: at,
      updatedAt: at,
    },
    0,
  );
  await stores.growth.createAppointment({
    organizationId: id,
    title: "Legacy test appointment",
    startsAt: "2035-01-02T12:00:00Z",
    status: "scheduled",
    source: "manual",
  });
  const callId = newId("rc_export");
  const call: CallSession = {
    id: callId,
    callSid: newId("CA_export"),
    clientAccountId: client,
    configId: "export-fixture",
    fromE164: "+14385550123",
    toE164: "+14385550000",
    language: "en",
    status: "completed",
    step: "done",
    afterHours: false,
    slots: {},
    turns: [
      { at, speaker: "caller", text: "Customer call transcript" },
      { at, speaker: "system", text: "EXCLUDED_SYSTEM_PROMPT" },
    ],
    silenceCount: 0,
    callerTurnCount: 1,
    transfers: [],
    recordingUrl: "https://example.invalid/EXCLUDED_RECORDING",
    notifications: [],
    startedAt: at,
    endedAt: at,
    finalizedAt: at,
    updatedAt: at,
    version: 1,
  };
  await stores.receptionist.insertSessionIfAbsent(call);
  await stores.missed.saveCall({
    id: newId("mc_export"),
    clientAccountId: client,
    callerE164: "+14385550123",
    calledAt: at,
    disposition: "missed",
    recordingUrl: "https://example.invalid/EXCLUDED_AUDIO",
  });
  const ticketId = newId("tic_export");
  await stores.support.saveTicket({
    id: ticketId,
    organizationId: id,
    subject: "Export support ticket",
    category: "other",
    kind: "issue",
    description: "Customer-visible description",
    priority: "normal",
    status: "open",
    contactEmail: "export@example.invalid",
    assignedTo: "EXCLUDED_INTERNAL_ASSIGNMENT",
    createdAt: at,
    updatedAt: at,
  });
  await stores.support.saveMessage({
    id: newId("sm_export"),
    ticketId,
    authorRole: "admin",
    body: "EXCLUDED_INTERNAL_NOTE",
    internal: true,
    createdAt: at,
  });
  await stores.support.saveMessage({
    id: newId("sm_export"),
    ticketId,
    authorRole: "contractor",
    body: "Visible support reply",
    internal: false,
    createdAt: at,
  });
  await stores.support.saveAccountRequest({
    id: newId("ar_export"),
    organizationId: id,
    kind: "deletion",
    status: "requested",
    phoneRouting: "unchanged_until_transition",
    createdAt: at,
  });
  return { captured, callId, ticketId, quoteId, appointmentId };
}
