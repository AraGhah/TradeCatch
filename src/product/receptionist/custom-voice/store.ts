import { createId } from "@/lib/id";
import type { OrgVoiceRecord, VoiceEvent } from "./model";

/**
 * Persistence for a business's custom voice. Every method is scoped by
 * organization id: there is deliberately no "list everyone's voices" call, so a
 * bug in a route cannot read across tenants through this interface.
 */
export type OrgVoiceStore = {
  get(organizationId: string): Promise<OrgVoiceRecord | null>;
  /**
   * Optimistic save. A record with `version: 0` is inserted; any other is
   * updated only if the stored version still matches. Returns the saved record,
   * or null if someone else changed it first (the caller re-reads and decides).
   */
  save(record: OrgVoiceRecord): Promise<OrgVoiceRecord | null>;
  /** Removes the row (used when the provider voice and consent are gone). */
  remove(organizationId: string): Promise<void>;
  addEvent(event: Omit<VoiceEvent, "id">): Promise<VoiceEvent>;
  listEvents(organizationId: string, limit?: number): Promise<VoiceEvent[]>;
};

export function createMemoryVoiceStore(): OrgVoiceStore {
  const records = new Map<string, OrgVoiceRecord>();
  const events: VoiceEvent[] = [];

  return {
    async get(organizationId) {
      const found = records.get(organizationId);
      return found ? structuredClone(found) : null;
    },

    async save(record) {
      const current = records.get(record.organizationId);
      if (record.version === 0) {
        if (current) return null;
      } else if (!current || current.version !== record.version) {
        return null;
      }
      const saved: OrgVoiceRecord = { ...record, version: record.version + 1 };
      records.set(saved.organizationId, structuredClone(saved));
      return structuredClone(saved);
    },

    async remove(organizationId) {
      records.delete(organizationId);
    },

    async addEvent(event) {
      const stored: VoiceEvent = { ...event, id: createId("rve") };
      events.push(stored);
      return structuredClone(stored);
    },

    async listEvents(organizationId, limit = 50) {
      return events
        .filter((e) => e.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(1, Math.min(limit, 200)))
        .map((e) => structuredClone(e));
    },
  };
}
