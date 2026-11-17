/**
 * Connecting a business to its own Cal.com account.
 *
 * The contractor pastes a Cal.com API key and says which event type books
 * which service or specialist. Nothing is stored until the key has been proven
 * against Cal.com, and every mapping is checked against *this* business's own
 * services and specialists, so one business can never point at another's.
 */

import type { SchedulingStore } from "../store";
import type { SchedulingService } from "../service";
import { createCalcomClient, type CalcomEventType } from "./client";
import { isValidCalcomApiKey, sealCalcomApiKey } from "./credentials";
import {
  toPublicConnection,
  type CalcomConnectionPublic,
  type CalcomEventTypeMapping,
} from "./types";

export type ConnectCalcomInput = {
  organizationId: string;
  apiKey: string;
  /** Empty with exactly one event type on the account: that one is the default. */
  eventTypes?: CalcomEventTypeMapping[];
  fallbackAttendeeEmail?: string;
  language?: "fr" | "en";
};

export type ConnectCalcomResult =
  | {
      ok: true;
      connection: CalcomConnectionPublic;
      available: Pick<CalcomEventType, "id" | "title" | "lengthInMinutes" | "ownerName">[];
    }
  | {
      ok: false;
      code:
        | "invalid_key_format"
        | "key_rejected"
        | "calcom_unreachable"
        | "no_event_types"
        | "mapping_required"
        | "unknown_event_type"
        | "unknown_service"
        | "unknown_technician"
        | "duplicate_mapping";
    };

export async function connectCalcom(
  deps: {
    store: SchedulingStore;
    service: Pick<SchedulingService, "getRules">;
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
  },
  input: ConnectCalcomInput,
): Promise<ConnectCalcomResult> {
  const apiKey = input.apiKey.trim();
  if (!isValidCalcomApiKey(apiKey)) {
    return { ok: false, code: "invalid_key_format" };
  }
  const client = createCalcomClient({
    apiKey,
    fetchImpl: deps.fetchImpl,
    env: deps.env,
  });
  const listed = await client.listEventTypes();
  if (!listed.ok) {
    return {
      ok: false,
      code:
        listed.kind === "auth" || listed.kind === "rejected"
          ? "key_rejected"
          : "calcom_unreachable",
    };
  }
  const usable = listed.data.filter((type) => !type.hidden);
  if (usable.length === 0) return { ok: false, code: "no_event_types" };

  let mappings = input.eventTypes ?? [];
  if (mappings.length === 0) {
    if (usable.length !== 1) return { ok: false, code: "mapping_required" };
    mappings = [{ eventTypeId: usable[0].id }];
  }

  const [services, technicians] = await Promise.all([
    deps.store.listServices(input.organizationId),
    deps.store.listTechnicians(input.organizationId),
  ]);
  const seen = new Set<string>();
  const clean: CalcomEventTypeMapping[] = [];
  for (const mapping of mappings) {
    if (!usable.some((type) => type.id === mapping.eventTypeId)) {
      return { ok: false, code: "unknown_event_type" };
    }
    if (
      mapping.serviceId &&
      !services.some((s) => s.id === mapping.serviceId)
    ) {
      return { ok: false, code: "unknown_service" };
    }
    if (
      mapping.technicianId &&
      !technicians.some((t) => t.id === mapping.technicianId)
    ) {
      return { ok: false, code: "unknown_technician" };
    }
    const key = `${mapping.serviceId ?? ""}|${mapping.technicianId ?? ""}`;
    if (seen.has(key)) return { ok: false, code: "duplicate_mapping" };
    seen.add(key);
    clean.push({
      eventTypeId: mapping.eventTypeId,
      ...(mapping.serviceId ? { serviceId: mapping.serviceId } : {}),
      ...(mapping.technicianId ? { technicianId: mapping.technicianId } : {}),
      ...(mapping.lengthInMinutes
        ? { lengthInMinutes: mapping.lengthInMinutes }
        : {}),
      ...(mapping.addressAsLocation ? { addressAsLocation: true } : {}),
    });
  }

  const row = {
    organizationId: input.organizationId,
    status: "connected" as const,
    credentialCiphertext: sealCalcomApiKey(apiKey),
    accountLabel: undefined,
    eventTypes: clean,
    fallbackAttendeeEmail: input.fallbackAttendeeEmail?.trim() || undefined,
    language: input.language ?? "en",
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  };
  await deps.store.saveCalcomConnection(row);
  const rules = await deps.service.getRules(input.organizationId);
  rules.calendarMode = "calcom";
  await deps.store.saveRules(rules);
  return {
    ok: true,
    connection: toPublicConnection(row),
    available: usable.map((type) => ({
      id: type.id,
      title: type.title,
      lengthInMinutes: type.lengthInMinutes,
      ownerName: type.ownerName,
    })),
  };
}
