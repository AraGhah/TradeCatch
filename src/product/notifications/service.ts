import { createId } from "@/lib/id";
import {
  isInsideSendingWindow,
  nextWindowStart,
} from "@/product/sms-automation/window";
import { defaultPreferences, renderNotice } from "./templates";
import type { NotificationStore } from "./store";
import {
  TYPE_CATEGORY,
  TYPE_PRIORITY,
  type Channel,
  type ContractorNotification,
  type EscalationRule,
  type NotificationDelivery,
  type NotificationPayload,
  type NotificationPreferences,
  type NotificationRecipient,
  type NotificationType,
  type Priority,
} from "./types";

export class NotificationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export type NoticeMember = {
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  email: string;
  locale: "en" | "fr";
  phoneE164?: string;
};

export type NoticeOrg = {
  id: string;
  name: string;
  status: string;
  timezone: string;
  localeDefault: "en" | "fr";
  phoneE164?: string | null;
  accountType?: string;
};

export type NotificationDeps = {
  store: NotificationStore;
  now: () => Date;
  listMembers: (organizationId: string) => Promise<NoticeMember[]>;
  loadOrg: (organizationId: string) => Promise<NoticeOrg | null>;
  sendEmail?: (input: {
    idempotencyKey?: string;
    to: string;
    subject: string;
    title: string;
    message: string;
  }) => Promise<{ sent: boolean; temporary?: boolean; reason?: string }>;
  sendSms?: (input: { to: string; body: string }) => Promise<{
    sent: boolean;
    sid?: string;
    temporary?: boolean;
    reason?: string;
  }>;
};

const MAX_ATTEMPTS = 3;
const GROUP_MS = 15 * 60_000;
const RATE_LIMIT = 40;

function hrefFor(type: NotificationType, payload: NotificationPayload): string {
  if (payload.href) return payload.href;
  if (payload.leadId) return `/app/leads/${payload.leadId}`;
  if (
    type === "lead_created" ||
    type === "urgent_request" ||
    type === "missed_call_recovered" ||
    type === "human_requested"
  ) {
    return "/app/leads";
  }
  if (type.startsWith("appointment")) return "/app/bookings";
  if (
    type === "customer_message" ||
    type === "quote_response" ||
    type === "quote_accepted"
  )
    return "/app/conversations";
  if (type === "transfer_failed" || type === "receptionist_offline")
    return "/app/calls";
  return "/app/notifications";
}

function defaultRule(organizationId: string, at: string): EscalationRule {
  return {
    organizationId,
    enabled: true,
    emailEnabled: true,
    smsEnabled: true,
    acknowledgementRequired: true,
    delayMinutes: 15,
    maxAttempts: 2,
    afterHours: true,
    updatedAt: at,
  };
}

export function createNotificationService(deps: NotificationDeps) {
  async function prefsFor(org: NoticeOrg, member: NoticeMember) {
    const existing = await deps.store.getPreferences(org.id, member.userId);
    if (existing) return existing;
    const created = defaultPreferences(
      org.id,
      member.userId,
      member.locale || org.localeDefault,
      deps.now().toISOString(),
    );
    if (member.role === "member" || member.role === "viewer")
      created.scope = "assigned";
    await deps.store.savePreferences(created);
    return created;
  }

  function windowConfig(prefs: NotificationPreferences) {
    const [sh, sm] = prefs.quietEnd.split(":").map(Number);
    const [eh, em] = prefs.quietStart.split(":").map(Number);
    return {
      windowStartHour: sh ?? 8,
      windowEndHour: eh ?? 20,
      weekendSending: true,
      startMinute: sm ?? 0,
      endMinute: em ?? 0,
    };
  }

  function allowedNow(
    priority: Priority,
    prefs: NotificationPreferences,
    rule: EscalationRule,
    org: NoticeOrg,
  ) {
    if (!prefs.quietEnabled) return true;
    if ((priority === "critical" || priority === "high") && rule.afterHours)
      return true;
    const config = windowConfig(prefs);
    return isInsideSendingWindow(
      deps.now(),
      org.timezone || "America/Toronto",
      config,
    );
  }

  async function attempt(
    delivery: NotificationDelivery,
    notification: ContractorNotification,
    org: NoticeOrg,
  ) {
    let externalMessage = notification.message;
    if (notification.type === "gmail_reply" && delivery.channel !== "in_app") {
      const member = (await deps.listMembers(org.id)).find(
        (m) => m.userId === delivery.recipientUserId,
      );
      const prefs = member ? await prefsFor(org, member) : null;
      if (
        !member ||
        !prefs?.categories.replies[delivery.channel] ||
        (delivery.channel === "email" && delivery.destination !== member.email)
      ) {
        delivery.status = "canceled";
        delivery.lastError = "recipient_or_preferences_changed";
        delivery.updatedAt = deps.now().toISOString();
        await deps.store.saveDelivery(delivery);
        return;
      }
      const rule =
        (await deps.store.getEscalation(org.id)) ??
        defaultRule(org.id, deps.now().toISOString());
      if (!allowedNow(notification.priority, prefs, rule, org)) {
        delivery.status = "pending";
        delivery.nextAttemptAt = nextWindowStart(
          deps.now(),
          org.timezone,
          windowConfig(prefs),
        ).toISOString();
        delivery.updatedAt = deps.now().toISOString();
        await deps.store.saveDelivery(delivery);
        return;
      }
      // External alerts reveal no sender, subject, or message body, including
      // when the configured business SMS number is shared with colleagues.
      externalMessage = renderNotice("gmail_reply", prefs.language, {
        business: org.name,
      }).message;
    }
    if (
      delivery.simulated ||
      notification.simulated ||
      org.accountType === "demo"
    ) {
      delivery.status = "simulated";
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      return;
    }
    if (org.status !== "active") {
      delivery.status = "canceled";
      delivery.lastError = "organization_suspended";
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      return;
    }
    delivery.attempts += 1;
    try {
      if (delivery.channel === "email") {
        const result = await deps.sendEmail?.({
          idempotencyKey: delivery.idempotencyKey,
          to: delivery.destination || "",
          subject: notification.title,
          title: notification.title,
          message: externalMessage,
        });
        if (!result?.sent)
          throw Object.assign(new Error(result?.reason || "email_failed"), {
            temporary: result?.temporary !== false,
          });
        delivery.status = "submitted";
      } else if (delivery.channel === "sms") {
        if (!org.phoneE164 || delivery.destination !== org.phoneE164) {
          delivery.status = "canceled";
          delivery.lastError = "unauthorized_destination";
          delivery.updatedAt = deps.now().toISOString();
          await deps.store.saveDelivery(delivery);
          return;
        }
        const result = await deps.sendSms?.({
          to: delivery.destination,
          body: externalMessage.slice(0, 320),
        });
        if (!result?.sent)
          throw Object.assign(new Error(result?.reason || "sms_failed"), {
            temporary: result?.temporary !== false,
          });
        delivery.status = "submitted";
        delivery.providerSid = result.sid;
      } else {
        delivery.status = "delivered";
      }
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
    } catch (error) {
      const temporary =
        !(error instanceof Error) ||
        !("temporary" in error) ||
        Boolean((error as { temporary?: boolean }).temporary);
      delivery.lastError = (
        error instanceof Error ? error.message : "delivery_failed"
      ).slice(0, 200);
      if (!temporary || delivery.attempts >= MAX_ATTEMPTS) {
        delivery.status = temporary ? "dead" : "failed";
        await deps.store.saveAlert({
          id: createId("alert"),
          organizationId: org.id,
          component: delivery.channel,
          severity: "high",
          message: `Notification delivery ${delivery.status} for ${notification.type}`,
          correlationId: delivery.id,
          createdAt: deps.now().toISOString(),
        });
      } else {
        delivery.status = "pending";
        const wait = [1, 5, 15][delivery.attempts - 1] ?? 15;
        delivery.nextAttemptAt = new Date(
          deps.now().getTime() + wait * 60_000,
        ).toISOString();
      }
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
    }
  }

  async function fanOut(
    notification: ContractorNotification,
    payload: NotificationPayload,
    org: NoticeOrg,
  ) {
    if (notification.type === "gmail_reply" && !payload.recipientUserId) {
      throw new NotificationError("Mailbox owner required.");
    }
    const rule =
      (await deps.store.getEscalation(org.id)) ??
      defaultRule(org.id, deps.now().toISOString());
    if (!(await deps.store.getEscalation(org.id)))
      await deps.store.saveEscalation(rule);
    const members = await deps.listMembers(org.id);
    const recent = await deps.store.listDeliveries(org.id);
    const recentCount = recent.filter(
      (row) => Date.parse(row.createdAt) > deps.now().getTime() - 10 * 60_000,
    ).length;
    const limited = recentCount >= RATE_LIMIT;
    for (const member of members) {
      if (payload.recipientUserId && payload.recipientUserId !== member.userId)
        continue;
      const prefs = await prefsFor(org, member);
      if (
        !payload.recipientUserId &&
        (member.role === "member" || member.role === "viewer") &&
        prefs.scope === "assigned" &&
        payload.assigneeUserId !== member.userId
      ) {
        continue;
      }
      if (
        !payload.recipientUserId &&
        rule.primaryUserId &&
        (member.role === "member" || member.role === "viewer") &&
        member.userId !== rule.primaryUserId &&
        member.userId !== payload.assigneeUserId
      ) {
        continue;
      }
      const category = TYPE_CATEGORY[notification.type];
      const channels = prefs.categories[category];
      const recipient: NotificationRecipient = {
        id: createId("nrcp"),
        notificationId: notification.id,
        organizationId: org.id,
        userId: member.userId,
      };
      const existingRecipient = (
        await deps.store.listRecipients(org.id, notification.id)
      ).find((row) => row.userId === member.userId);
      if (
        !existingRecipient &&
        (notification.type !== "gmail_reply" || channels.inApp)
      )
        await deps.store.saveRecipient(recipient);
      const language = prefs.language;
      const rendered = renderNotice(notification.type, language, {
        business: org.name,
        customer: payload.customer,
        service: payload.service,
        location: payload.location,
        when: payload.whenLabel,
      });
      if (payload.recipientUserId || member.userId === members[0]?.userId) {
        notification.title = rendered.title;
        notification.message = payload.message || rendered.message;
        notification.updatedAt = deps.now().toISOString();
        await deps.store.saveNotification(notification);
      }
      const selected: Channel[] = [
        channels.inApp ? "in_app" : null,
        channels.email ? "email" : null,
        channels.sms ? "sms" : null,
      ].filter((channel): channel is Channel => Boolean(channel));
      for (const channel of selected) {
        if (
          limited &&
          channel !== "in_app" &&
          notification.type !== "gmail_reply"
        )
          continue;
        const destination =
          channel === "email"
            ? member.email
            : channel === "sms"
              ? org.phoneE164 || undefined
              : undefined;
        if (channel !== "in_app" && !destination) continue;
        let when = allowedNow(notification.priority, prefs, rule, org)
          ? deps.now().toISOString()
          : nextWindowStart(
              deps.now(),
              org.timezone || "America/Toronto",
              windowConfig(prefs),
            ).toISOString();
        if (limited && channel !== "in_app")
          when = new Date(
            Math.max(Date.parse(when), deps.now().getTime() + 10 * 60_000),
          ).toISOString();
        const delivery: NotificationDelivery = {
          id: createId("ndlv"),
          notificationId: notification.id,
          organizationId: org.id,
          recipientUserId: member.userId,
          channel,
          status: "pending",
          attempts: 0,
          nextAttemptAt: when,
          destination,
          simulated: notification.simulated || org.accountType === "demo",
          idempotencyKey: `${notification.id}:${member.userId}:${channel}`,
          createdAt: deps.now().toISOString(),
          updatedAt: deps.now().toISOString(),
        };
        await deps.store.saveDelivery(delivery);
        // processDue claims deliveries atomically after fan-out. Concurrent
        // push/cron/manual requests cannot send the same pending row together.
      }
    }
  }

  return {
    async enqueue(input: {
      organizationId: string;
      type: NotificationType;
      idempotencyKey: string;
      payload?: NotificationPayload;
    }) {
      const org = await deps.loadOrg(input.organizationId);
      if (!org) throw new NotificationError("Business not found.", 404);
      if (input.type === "gmail_reply" && !input.payload?.recipientUserId)
        throw new NotificationError("Mailbox owner required.");
      const inserted = await deps.store.insertOutbox({
        id: createId("outbox"),
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
        type: input.type,
        payload: input.payload ?? {},
        status: "pending",
        attempts: 0,
        createdAt: deps.now().toISOString(),
        updatedAt: deps.now().toISOString(),
      });
      return { queued: Boolean(inserted), duplicate: !inserted };
    },

    async processDue(limit = 25, type?: NotificationType) {
      const claimed = await deps.store.claimOutbox(
        limit,
        deps.now().toISOString(),
        type,
      );
      for (const event of claimed) {
        const org = await deps.loadOrg(event.organizationId);
        if (!org) {
          event.status = "dead";
          event.updatedAt = deps.now().toISOString();
          await deps.store.saveOutbox(event);
          continue;
        }
        const existing = await deps.store.findNotificationByKey(
          org.id,
          event.idempotencyKey,
        );
        if (existing) {
          await fanOut(existing, event.payload, org);
          event.status = "done";
          event.updatedAt = deps.now().toISOString();
          await deps.store.saveOutbox(event);
          continue;
        }
        const since = new Date(deps.now().getTime() - GROUP_MS).toISOString();
        const grouped = event.payload.consolidateKey
          ? await deps.store.findRecentConsolidated(
              org.id,
              event.payload.consolidateKey,
              since,
            )
          : null;
        if (grouped) {
          const extra = renderNotice(event.type, org.localeDefault, {
            business: org.name,
            customer: event.payload.customer,
            service: event.payload.service,
            location: event.payload.location,
            when: event.payload.whenLabel,
          });
          grouped.message = `${grouped.message} ${extra.message}`.slice(0, 500);
          grouped.updatedAt = deps.now().toISOString();
          await deps.store.saveNotification(grouped);
          await deps.store.addEvent({
            organizationId: org.id,
            notificationId: grouped.id,
            kind: "grouped",
            detail: event.type,
            at: deps.now().toISOString(),
          });
          event.status = "done";
          event.updatedAt = deps.now().toISOString();
          await deps.store.saveOutbox(event);
          continue;
        }
        const rendered = renderNotice(event.type, org.localeDefault, {
          business: org.name,
          customer: event.payload.customer,
          service: event.payload.service,
          location: event.payload.location,
          when: event.payload.whenLabel,
        });
        const notification: ContractorNotification = {
          id: createId("notif"),
          organizationId: org.id,
          type: event.type,
          title: rendered.title,
          message: event.payload.message || rendered.message,
          priority: TYPE_PRIORITY[event.type],
          leadId: event.payload.leadId,
          appointmentId: event.payload.appointmentId,
          callId: event.payload.callId,
          href: hrefFor(event.type, event.payload),
          consolidateKey: event.payload.consolidateKey,
          idempotencyKey: event.idempotencyKey,
          simulated:
            Boolean(event.payload.simulated) || org.accountType === "demo",
          createdAt: deps.now().toISOString(),
          updatedAt: deps.now().toISOString(),
        };
        await deps.store.saveNotification(notification);
        await fanOut(notification, event.payload, org);
        event.status = "done";
        event.updatedAt = deps.now().toISOString();
        await deps.store.saveOutbox(event);
      }
      const due = await deps.store.claimDeliveries(
        deps.now().toISOString(),
        type,
      );
      for (const delivery of due) {
        const org = await deps.loadOrg(delivery.organizationId);
        const notification = org
          ? await deps.store.getNotification(org.id, delivery.notificationId)
          : null;
        if (!org || !notification) continue;
        await attempt(delivery, notification, org);
      }
      return { processed: claimed.length };
    },

    async processEscalations(asOf = deps.now()) {
      const orgs = await deps.store.listOrganizations();
      let escalated = 0;
      for (const organizationId of orgs) {
        const org = await deps.loadOrg(organizationId);
        const rule = await deps.store.getEscalation(organizationId);
        if (
          !org ||
          !rule?.enabled ||
          !rule.acknowledgementRequired ||
          !rule.secondaryUserId
        )
          continue;
        const notes = await deps.store.listNotifications(organizationId);
        for (const note of notes) {
          if (note.priority === "normal") continue;
          const people = await deps.store.listRecipients(
            organizationId,
            note.id,
          );
          if (people.some((person) => person.acknowledgedAt)) continue;
          const prior = await deps.store.listEscalationAttempts(
            organizationId,
            note.id,
          );
          if (prior.length >= rule.maxAttempts) continue;
          if (
            Date.parse(note.createdAt) + rule.delayMinutes * 60_000 >
            asOf.getTime()
          )
            continue;
          const members = await deps.listMembers(organizationId);
          const backup = members.find(
            (member) => member.userId === rule.secondaryUserId,
          );
          if (!backup) continue;
          if (people.some((person) => person.userId === backup.userId))
            continue;
          await deps.store.saveRecipient({
            id: createId("nrcp"),
            notificationId: note.id,
            organizationId,
            userId: backup.userId,
          });
          const delivery: NotificationDelivery = {
            id: createId("ndlv"),
            notificationId: note.id,
            organizationId,
            recipientUserId: backup.userId,
            channel: rule.smsEnabled ? "sms" : "email",
            status: "pending",
            attempts: 0,
            nextAttemptAt: deps.now().toISOString(),
            destination: rule.smsEnabled
              ? org.phoneE164 || undefined
              : backup.email,
            simulated: note.simulated,
            idempotencyKey: `${note.id}:${backup.userId}:escalation:${prior.length + 1}`,
            createdAt: deps.now().toISOString(),
            updatedAt: deps.now().toISOString(),
          };
          const saved = await deps.store.saveDelivery(delivery);
          if (saved) await attempt(saved, note, org);
          await deps.store.addEscalationAttempt({
            organizationId,
            notificationId: note.id,
            recipientUserId: backup.userId,
            outcome: "backup_notified",
            at: deps.now().toISOString(),
          });
          escalated += 1;
        }
      }
      return { escalated };
    },

    async listForUser(
      organizationId: string,
      userId: string,
      filter?: {
        type?: string;
        priority?: string;
        status?: string;
        q?: string;
      },
    ) {
      const [notes, recipients] = await Promise.all([
        deps.store.listNotifications(organizationId),
        deps.store.listRecipients(organizationId),
      ]);
      return notes
        .map((note) => ({
          note,
          recipient: recipients.find(
            (row) => row.notificationId === note.id && row.userId === userId,
          ),
        }))
        .filter((row) => row.recipient)
        .filter((row) => {
          if (filter?.type && row.note.type !== filter.type) return false;
          if (filter?.priority && row.note.priority !== filter.priority)
            return false;
          if (filter?.status === "unread" && row.recipient?.readAt)
            return false;
          if (filter?.status === "read" && !row.recipient?.readAt) return false;
          if (
            filter?.status === "acknowledged" &&
            !row.recipient?.acknowledgedAt
          )
            return false;
          if (
            filter?.q &&
            !`${row.note.title} ${row.note.message}`
              .toLowerCase()
              .includes(filter.q.toLowerCase())
          )
            return false;
          return true;
        });
    },

    async unreadCount(organizationId: string, userId: string) {
      return deps.store.countUnread(organizationId, userId);
    },

    async getForUser(
      organizationId: string,
      userId: string,
      notificationId: string,
    ) {
      const note = await deps.store.getNotification(
        organizationId,
        notificationId,
      );
      if (!note) throw new NotificationError("Notification not found.", 404);
      const recipient = (
        await deps.store.listRecipients(organizationId, notificationId)
      ).find((row) => row.userId === userId);
      if (!recipient)
        throw new NotificationError("Notification not found.", 404);
      const deliveries = (
        await deps.store.listDeliveries(organizationId)
      ).filter((row) => row.notificationId === notificationId);
      const escalation = await deps.store.listEscalationAttempts(
        organizationId,
        notificationId,
      );
      return { notification: note, recipient, deliveries, escalation };
    },

    async markRead(
      organizationId: string,
      userId: string,
      notificationId: string,
    ) {
      const detail = await this.getForUser(
        organizationId,
        userId,
        notificationId,
      );
      if (!detail.recipient.readAt) {
        detail.recipient.readAt = deps.now().toISOString();
        await deps.store.saveRecipient(detail.recipient);
      }
      return detail.recipient;
    },

    async markAllRead(organizationId: string, userId: string) {
      const rows = await deps.store.listRecipients(organizationId);
      let updated = 0;
      for (const row of rows) {
        if (row.userId !== userId || row.readAt) continue;
        row.readAt = deps.now().toISOString();
        await deps.store.saveRecipient(row);
        updated += 1;
      }
      return updated;
    },

    async acknowledge(
      organizationId: string,
      userId: string,
      notificationId: string,
    ) {
      const detail = await this.getForUser(
        organizationId,
        userId,
        notificationId,
      );
      detail.recipient.readAt =
        detail.recipient.readAt ?? deps.now().toISOString();
      detail.recipient.acknowledgedAt = deps.now().toISOString();
      detail.recipient.acknowledgedBy = userId;
      await deps.store.saveRecipient(detail.recipient);
      await deps.store.addEscalationAttempt({
        organizationId,
        notificationId,
        recipientUserId: userId,
        outcome: "acknowledged",
        at: deps.now().toISOString(),
      });
      return detail.recipient;
    },

    async getPreferences(
      organizationId: string,
      userId: string,
      language: "en" | "fr",
    ) {
      const org = await deps.loadOrg(organizationId);
      if (!org) throw new NotificationError("Business not found.", 404);
      return prefsFor(org, {
        userId,
        role: "owner",
        email: "",
        locale: language,
      });
    },

    async savePreferences(row: NotificationPreferences) {
      row.updatedAt = deps.now().toISOString();
      await deps.store.savePreferences(row);
      return row;
    },

    async getEscalation(organizationId: string) {
      return (
        (await deps.store.getEscalation(organizationId)) ??
        defaultRule(organizationId, deps.now().toISOString())
      );
    },

    async saveEscalation(rule: EscalationRule) {
      rule.updatedAt = deps.now().toISOString();
      rule.delayMinutes = Math.min(Math.max(rule.delayMinutes, 1), 240);
      rule.maxAttempts = Math.min(Math.max(rule.maxAttempts, 1), 5);
      await deps.store.saveEscalation(rule);
      return rule;
    },

    async history(organizationId: string) {
      return deps.store.listDeliveries(organizationId);
    },

    async listAlerts() {
      return deps.store.listAlerts();
    },

    async listFailures() {
      const orgs = await deps.store.listOrganizations();
      const rows = [];
      for (const organizationId of orgs) {
        const deliveries = await deps.store.listDeliveries(organizationId);
        rows.push(
          ...deliveries.filter(
            (row) => row.status === "failed" || row.status === "dead",
          ),
        );
      }
      return rows;
    },

    async applyProviderStatus(sid: string, status: string) {
      const delivery = await deps.store.findDeliveryBySid(sid);
      if (!delivery) return false;
      if (status === "delivered") delivery.status = "delivered";
      else if (status === "failed" || status === "undelivered")
        delivery.status = "failed";
      else delivery.status = "submitted";
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      return true;
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
