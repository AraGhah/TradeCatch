import { createId } from "@/lib/id";
import {
  applySmsStatus,
  DELIVERY_RATE_LIMIT,
  DELIVERY_WINDOW_MS,
  priorityRank,
} from "./delivery-policy";
import { TYPE_PRIORITY } from "./types";
import type {
  ContractorNotification,
  EscalationRule,
  NotificationDelivery,
  NotificationPayload,
  NotificationPreferences,
  NotificationRecipient,
  NotificationType,
  OutboxEvent,
  SystemAlert,
} from "./types";

export type NotificationStore = {
  insertOutbox(row: OutboxEvent): Promise<OutboxEvent | null>;
  claimOutbox(
    limit: number,
    nowIso: string,
    type?: NotificationType,
  ): Promise<OutboxEvent[]>;
  saveOutbox(row: OutboxEvent): Promise<void>;
  findNotificationByKey(
    organizationId: string,
    key: string,
  ): Promise<ContractorNotification | null>;
  findRecentConsolidated(
    organizationId: string,
    key: string,
    sinceIso: string,
  ): Promise<ContractorNotification | null>;
  saveNotification(row: ContractorNotification): Promise<void>;
  listNotifications(organizationId: string): Promise<ContractorNotification[]>;
  getNotification(
    organizationId: string,
    id: string,
  ): Promise<ContractorNotification | null>;
  saveRecipient(row: NotificationRecipient): Promise<void>;
  listRecipients(
    organizationId: string,
    notificationId?: string,
  ): Promise<NotificationRecipient[]>;
  countUnread(organizationId: string, userId: string): Promise<number>;
  saveDelivery(
    row: NotificationDelivery,
    onlyIfNew?: boolean,
  ): Promise<NotificationDelivery | null>;
  listDeliveries(organizationId: string): Promise<NotificationDelivery[]>;
  dueDeliveries(nowIso: string): Promise<NotificationDelivery[]>;
  claimDeliveries(
    nowIso: string,
    type?: NotificationType,
  ): Promise<NotificationDelivery[]>;
  findDeliveryBySid(sid: string): Promise<NotificationDelivery | null>;
  applySmsStatus(
    sid: string,
    status: string,
    errorCode: string | undefined,
    nowIso: string,
  ): Promise<NotificationDelivery | null>;
  listUnrecoveredSms(): Promise<NotificationDelivery[]>;
  markSmsRecovered(id: string, nowIso: string): Promise<void>;
  getPreferences(
    organizationId: string,
    userId: string,
  ): Promise<NotificationPreferences | null>;
  savePreferences(row: NotificationPreferences): Promise<void>;
  getEscalation(organizationId: string): Promise<EscalationRule | null>;
  saveEscalation(row: EscalationRule): Promise<void>;
  addEscalationAttempt(input: {
    organizationId: string;
    notificationId: string;
    recipientUserId?: string;
    outcome: string;
    at: string;
  }): Promise<void>;
  listEscalationAttempts(
    organizationId: string,
    notificationId: string,
  ): Promise<{ outcome: string; at: string }[]>;
  addEvent(input: {
    organizationId: string;
    notificationId?: string;
    kind: string;
    detail?: string;
    at: string;
  }): Promise<void>;
  saveAlert(row: SystemAlert): Promise<void>;
  listAlerts(): Promise<SystemAlert[]>;
  listOrganizations(): Promise<string[]>;
};

export function createMemoryNotificationStore(): NotificationStore {
  const outbox = new Map<string, OutboxEvent>();
  const notes = new Map<string, ContractorNotification>();
  const recipients = new Map<string, NotificationRecipient>();
  const deliveries = new Map<string, NotificationDelivery>();
  const prefs = new Map<string, NotificationPreferences>();
  const rules = new Map<string, EscalationRule>();
  const attempts: {
    organizationId: string;
    notificationId: string;
    outcome: string;
    at: string;
  }[] = [];
  const alerts: SystemAlert[] = [];
  const reservations: { organizationId: string; at: string }[] = [];

  return {
    async insertOutbox(row) {
      const existing = [...outbox.values()].find(
        (item) =>
          item.organizationId === row.organizationId &&
          item.idempotencyKey === row.idempotencyKey,
      );
      if (existing) return null;
      outbox.set(row.id, structuredClone(row));
      return structuredClone(row);
    },
    async claimOutbox(limit, nowIso, type) {
      const rows = [...outbox.values()]
        .filter((row) => !type || row.type === type)
        .filter(
          (row) =>
            row.status === "pending" ||
            (row.status === "processing" &&
              row.updatedAt <
                new Date(Date.parse(nowIso) - 10 * 60_000).toISOString()),
        )
        .sort(
          (a, b) =>
            priorityRank(TYPE_PRIORITY[a.type]) -
              priorityRank(TYPE_PRIORITY[b.type]) ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .slice(0, limit);
      for (const row of rows) {
        row.status = "processing";
        row.updatedAt = nowIso;
        outbox.set(row.id, row);
      }
      return rows.map((row) => structuredClone(row));
    },
    async saveOutbox(row) {
      outbox.set(row.id, structuredClone(row));
    },
    async findNotificationByKey(organizationId, key) {
      const row = [...notes.values()].find(
        (item) =>
          item.organizationId === organizationId && item.idempotencyKey === key,
      );
      return row ? structuredClone(row) : null;
    },
    async findRecentConsolidated(organizationId, key, sinceIso) {
      const row = [...notes.values()]
        .filter(
          (item) =>
            item.organizationId === organizationId &&
            item.consolidateKey === key &&
            item.createdAt >= sinceIso,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return row ? structuredClone(row) : null;
    },
    async saveNotification(row) {
      notes.set(row.id, structuredClone(row));
    },
    async listNotifications(organizationId) {
      return [...notes.values()]
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((row) => structuredClone(row));
    },
    async getNotification(organizationId, id) {
      const row = notes.get(id);
      if (!row || row.organizationId !== organizationId) return null;
      return structuredClone(row);
    },
    async saveRecipient(row) {
      recipients.set(row.id, structuredClone(row));
    },
    async listRecipients(organizationId, notificationId) {
      return [...recipients.values()]
        .filter(
          (row) =>
            row.organizationId === organizationId &&
            (!notificationId || row.notificationId === notificationId),
        )
        .map((row) => structuredClone(row));
    },
    async countUnread(organizationId, userId) {
      let count = 0;
      for (const row of recipients.values()) {
        if (
          row.organizationId === organizationId &&
          row.userId === userId &&
          !row.readAt
        )
          count += 1;
      }
      return count;
    },
    async saveDelivery(row, onlyIfNew = false) {
      const dupe = [...deliveries.values()].find(
        (item) =>
          item.organizationId === row.organizationId &&
          item.idempotencyKey === row.idempotencyKey &&
          item.id !== row.id,
      );
      if (dupe || (onlyIfNew && deliveries.has(row.id))) return null;
      deliveries.set(row.id, structuredClone(row));
      return structuredClone(row);
    },
    async listDeliveries(organizationId) {
      return [...deliveries.values()]
        .filter((row) => row.organizationId === organizationId)
        .map((row) => structuredClone(row));
    },
    async dueDeliveries(nowIso) {
      return [...deliveries.values()]
        .filter(
          (row) =>
            row.status === "pending" &&
            (!row.nextAttemptAt || row.nextAttemptAt <= nowIso),
        )
        .map((row) => structuredClone(row));
    },
    async claimDeliveries(nowIso, type) {
      for (const row of deliveries.values()) {
        if (
          (row.status === "pending" ||
            (row.status === "processing" &&
              Date.parse(row.updatedAt) < Date.parse(nowIso) - 600_000)) &&
          row.attempts >= 3
        ) {
          row.status = "dead";
          row.updatedAt = nowIso;
        }
      }
      const rows = [...deliveries.values()]
        .filter(
          (row) =>
            (!type || notes.get(row.notificationId)?.type === type) &&
            ((row.status === "pending" &&
              (!row.nextAttemptAt || row.nextAttemptAt <= nowIso)) ||
              (row.status === "processing" &&
                Date.parse(row.updatedAt) < Date.parse(nowIso) - 600_000)),
        )
        .sort(
          (a, b) =>
            priorityRank(notes.get(a.notificationId)?.priority) -
              priorityRank(notes.get(b.notificationId)?.priority) ||
            a.createdAt.localeCompare(b.createdAt),
        );
      const claimed: NotificationDelivery[] = [];
      for (const row of rows) {
        if (claimed.length >= 25) break;
        if (row.channel !== "in_app") {
          const used = reservations.filter(
            (r) =>
              r.organizationId === row.organizationId &&
              Date.parse(r.at) > Date.parse(nowIso) - DELIVERY_WINDOW_MS,
          ).length;
          if (used >= DELIVERY_RATE_LIMIT) continue;
          reservations.push({ organizationId: row.organizationId, at: nowIso });
        }
        row.status = "processing";
        row.providerSid = undefined;
        row.updatedAt = nowIso;
        claimed.push(row);
      }
      return structuredClone(claimed);
    },
    async findDeliveryBySid(sid) {
      const row = [...deliveries.values()].find(
        (item) => item.providerSid === sid,
      );
      return row ? structuredClone(row) : null;
    },
    async applySmsStatus(sid, status, errorCode, nowIso) {
      const row = [...deliveries.values()].find(
        (item) => item.providerSid === sid,
      );
      if (!row) return null;
      applySmsStatus(row, status, errorCode, nowIso);
      return structuredClone(row);
    },
    async listUnrecoveredSms() {
      return structuredClone(
        [...deliveries.values()]
          .filter(
            (row) =>
              row.channel === "sms" &&
              ["failed", "dead"].includes(row.status) &&
              !row.recoveryHandledAt,
          )
          .slice(0, 25),
      );
    },
    async markSmsRecovered(id, nowIso) {
      const row = deliveries.get(id);
      if (row) row.recoveryHandledAt = nowIso;
    },
    async getPreferences(organizationId, userId) {
      return structuredClone(prefs.get(`${organizationId}:${userId}`) ?? null);
    },
    async savePreferences(row) {
      prefs.set(`${row.organizationId}:${row.userId}`, structuredClone(row));
    },
    async getEscalation(organizationId) {
      const row = rules.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveEscalation(row) {
      rules.set(row.organizationId, structuredClone(row));
    },
    async addEscalationAttempt(input) {
      attempts.push(input);
    },
    async listEscalationAttempts(organizationId, notificationId) {
      return attempts.filter(
        (row) =>
          row.organizationId === organizationId &&
          row.notificationId === notificationId,
      );
    },
    async addEvent() {
      return;
    },
    async saveAlert(row) {
      if (!alerts.some((alert) => alert.id === row.id))
        alerts.push(structuredClone(row));
    },
    async listAlerts() {
      return alerts.map((row) => structuredClone(row));
    },
    async listOrganizations() {
      return [...new Set([...notes.values()].map((row) => row.organizationId))];
    },
  };
}

export function newNotificationId(prefix: string) {
  return createId(prefix);
}

export type { NotificationPayload };
