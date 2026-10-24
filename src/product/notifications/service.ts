import { createId } from "@/lib/id";
import {
  isInsideSendingWindow,
  nextWindowStart,
} from "@/product/sms-automation/window";
import {
  isSummaryDue,
  localDateKey,
  startOfLocalDay,
  usableTimeZone,
} from "./daily-summary";
import {
  defaultPreferences,
  renderDailySummary,
  renderNotice,
  withDefaultCategories,
} from "./templates";
import type { NotificationStore } from "./store";
import { quietHours } from "./preferences";
import {
  TYPE_CATEGORY,
  TYPE_PRIORITY,
  type Channel,
  type ContractorNotification,
  type EscalationRule,
  type EscalationContact,
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
    readonly code?: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export type NoticeMember = {
  userId: string;
  name?: string;
  role: "owner" | "admin" | "member" | "viewer";
  email: string;
  locale: "en" | "fr";
  phoneE164?: string;
  phoneVerifiedAt?: string;
};

function verifiedPhone(member: NoticeMember, now: Date): string | undefined {
  const at = Date.parse(member.phoneVerifiedAt || "");
  return /^\+[1-9]\d{7,14}$/.test(member.phoneE164 || "") &&
    Number.isFinite(at) &&
    at <= now.getTime()
    ? member.phoneE164
    : undefined;
}

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

import { MAX_DELIVERY_ATTEMPTS, scheduleRetry } from "./delivery-policy";
const MAX_ATTEMPTS = MAX_DELIVERY_ATTEMPTS;
const GROUP_MS = 15 * 60_000;

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
    if (existing)
      return {
        ...existing,
        categories: withDefaultCategories(existing.categories),
      };
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

  function localized(
    note: ContractorNotification,
    org: NoticeOrg,
    language: "en" | "fr",
    external = false,
  ) {
    const content = note.content?.length
      ? note.content
      : [{ type: note.type, payload: {} }];
    const rendered = content.map(({ type, payload }) => {
      const text = renderNotice(
        type,
        language,
        type === "gmail_reply"
          ? {
              business: org.name,
            }
          : {
              business: org.name,
              customer: payload.customer,
              service: payload.service,
              location: payload.location,
              when: payload.whenLabel,
            },
      );
      return {
        ...text,
        message:
          !(external && type === "gmail_reply") && payload.message
            ? payload.message
            : text.message,
      };
    });
    // Legacy custom content (for example a targeted daily summary) is retained.
    const result = {
      ...note,
      title: rendered[0].title,
      message:
        !note.content?.length && note.type === "daily_summary"
          ? note.message
          : rendered
              .map((text) => text.message)
              .join(" ")
              .slice(0, 500),
    };
    delete result.content;
    return result;
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
      usableTimeZone(org.timezone),
      config,
    );
  }

  async function recoverSms(delivery: NotificationDelivery) {
    if (
      delivery.channel !== "sms" ||
      !["failed", "dead"].includes(delivery.status) ||
      delivery.recoveryHandledAt
    )
      return;
    const org = await deps.loadOrg(delivery.organizationId);
    const note = org
      ? await deps.store.getNotification(org.id, delivery.notificationId)
      : null;
    if (!org || !note) return;
    await deps.store.saveAlert({
      id: delivery.id + ":sms_failure",
      organizationId: org.id,
      component: "sms",
      severity: note.priority === "critical" ? "critical" : "high",
      message:
        "SMS notification could not be delivered after bounded recovery.",
      correlationId: delivery.id,
      createdAt: deps.now().toISOString(),
    });
    const rule =
      (await deps.store.getEscalation(org.id)) ??
      defaultRule(org.id, deps.now().toISOString());
    if (
      note.priority !== "normal" &&
      rule.enabled &&
      rule.emailEnabled &&
      org.status === "active"
    ) {
      const members = await deps.listMembers(org.id);
      const backup = rule.secondaryUserId
        ? members.find((member) => member.userId === rule.secondaryUserId)
        : (members.find(
            (member) =>
              ["owner", "admin"].includes(member.role) &&
              member.userId !== delivery.recipientUserId,
          ) ??
          members.find(
            (member) =>
              member.userId === delivery.recipientUserId &&
              ["owner", "admin"].includes(member.role),
          ));
      if (backup?.email) {
        const people = await deps.store.listRecipients(org.id, note.id);
        if (!people.some((person) => person.userId === backup.userId))
          await deps.store.saveRecipient({
            id: note.id + ":" + backup.userId + ":sms_recovery",
            notificationId: note.id,
            organizationId: org.id,
            userId: backup.userId,
          });
        // Stable keys make callback duplication and worker-crash recovery safe.
        await deps.store.saveDelivery(
          {
            id: delivery.id + ":backup_email",
            notificationId: note.id,
            organizationId: org.id,
            recipientUserId: backup.userId,
            channel: "email",
            status: "pending",
            attempts: 0,
            nextAttemptAt: deps.now().toISOString(),
            destination: backup.email,
            simulated:
              delivery.simulated ||
              note.simulated ||
              org.accountType === "demo",
            idempotencyKey: delivery.id + ":backup_email",
            createdAt: deps.now().toISOString(),
            updatedAt: deps.now().toISOString(),
          },
          true,
        );
      }
    }
    await deps.store.markSmsRecovered(delivery.id, deps.now().toISOString());
  }

  async function attempt(
    delivery: NotificationDelivery,
    notification: ContractorNotification,
    org: NoticeOrg,
  ) {
    const personalSms = delivery.channel === "sms";
    // Re-check membership and ownership before sending delayed notifications.
    const member = (await deps.listMembers(org.id)).find(
      (m) => m.userId === delivery.recipientUserId,
    );
    if (
      !member ||
      (personalSms &&
        verifiedPhone(member, deps.now()) !== delivery.destination) ||
      (delivery.channel === "email" && member.email !== delivery.destination)
    ) {
      delivery.status = "canceled";
      delivery.lastError = "recipient_changed";
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      return;
    }
    const prefs = await prefsFor(org, member);
    if (
      notification.type === "gmail_reply" &&
      delivery.channel !== "in_app" &&
      !prefs.categories.replies[delivery.channel]
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
        usableTimeZone(org.timezone),
        windowConfig(prefs),
      ).toISOString();
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      return;
    }
    const text = localized(notification, org, prefs.language, true);
    const externalMessage = text.message;
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
    if (delivery.attempts >= MAX_ATTEMPTS) {
      delivery.status = "dead";
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      await recoverSms(delivery);
      return;
    }
    // Persist the attempt before contacting the provider. A crash must not
    // reset the bounded retry budget; quiet-hour deferrals do not spend it.
    delivery.attempts += 1;
    await deps.store.saveDelivery(delivery);
    try {
      if (delivery.channel === "email") {
        const result = await deps.sendEmail?.({
          idempotencyKey: delivery.idempotencyKey,
          to: delivery.destination || "",
          subject: text.title,
          title: text.title,
          message: externalMessage,
        });
        if (!result?.sent)
          throw Object.assign(new Error(result?.reason || "email_failed"), {
            temporary: result?.temporary !== false,
          });
        delivery.status = "submitted";
      } else if (delivery.channel === "sms") {
        if (
          !delivery.destination ||
          (!personalSms &&
            (!org.phoneE164 || delivery.destination !== org.phoneE164))
        ) {
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
          id:
            delivery.id +
            (delivery.channel === "sms" ? ":sms_failure" : ":failure"),
          organizationId: org.id,
          component: delivery.channel,
          severity: "high",
          message: `Notification delivery ${delivery.status} for ${notification.type}`,
          correlationId: delivery.id,
          createdAt: deps.now().toISOString(),
        });
      } else {
        scheduleRetry(delivery, deps.now());
      }
      delivery.updatedAt = deps.now().toISOString();
      await deps.store.saveDelivery(delivery);
      await recoverSms(delivery);
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
    for (const member of members) {
      if (payload.recipientUserId && payload.recipientUserId !== member.userId)
        continue;
      // Outages are for the people who can act on them, whatever their scope.
      if (
        notification.type === "receptionist_offline" &&
        member.role !== "owner" &&
        member.role !== "admin"
      )
        continue;
      const prefs = await prefsFor(org, member);
      if (
        !payload.recipientUserId &&
        (member.role === "member" || member.role === "viewer") &&
        prefs.scope === "assigned" &&
        payload.assigneeUserId !== member.userId &&
        !(
          rule.enabled &&
          rule.primaryUserId === member.userId &&
          notification.priority !== "normal"
        )
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
        const destination =
          channel === "email"
            ? member.email
            : channel === "sms"
              ? verifiedPhone(member, deps.now())
              : undefined;
        if (channel !== "in_app" && !destination) continue;
        const when = allowedNow(notification.priority, prefs, rule, org)
          ? deps.now().toISOString()
          : nextWindowStart(
              deps.now(),
              usableTimeZone(org.timezone),
              windowConfig(prefs),
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
          idempotencyKey: `${notification.id}:${member.userId}:${channel}${channel === "sms" && rule.primaryUserId && notification.priority !== "normal" ? ":personal" : ""}`,
          createdAt: deps.now().toISOString(),
          updatedAt: deps.now().toISOString(),
        };
        await deps.store.saveDelivery(delivery);
        // processDue claims deliveries atomically after fan-out. Concurrent
        // push/cron/manual requests cannot send the same pending row together.
      }
    }
  }

  async function enqueueEvent(input: {
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
  }

  return {
    enqueue: enqueueEvent,

    /**
     * Queues one summary per opted-in member for the local day that is ending.
     * A business becomes due at DAILY_SUMMARY_HOUR in its own time zone; the
     * outbox's unique key per member and local date makes any number of
     * overlapping or repeated runs produce exactly one summary.
     */
    async generateDailySummaries(asOf = deps.now()) {
      const horizon = new Date(asOf.getTime() - 36 * 3_600_000).toISOString();
      let queued = 0;
      let duplicates = 0;
      for (const organizationId of await deps.store.listOrganizations(
        horizon,
      )) {
        const org = await deps.loadOrg(organizationId);
        if (!org || org.status !== "active") continue;
        const zone = usableTimeZone(org.timezone);
        if (!isSummaryDue(asOf, zone)) continue;
        const day = localDateKey(asOf, zone);
        const sinceIso = startOfLocalDay(asOf, zone).toISOString();
        const untilIso = asOf.toISOString();
        for (const member of await deps.listMembers(org.id)) {
          const prefs = await prefsFor(org, member);
          if (!prefs.dailySummary) continue;
          const message = renderDailySummary(
            prefs.language,
            org.name,
            await deps.store.countActivity({
              organizationId: org.id,
              userId: member.userId,
              sinceIso,
              untilIso,
            }),
          );
          // A quiet day sends nothing rather than an empty message.
          if (!message) continue;
          const result = await enqueueEvent({
            organizationId: org.id,
            type: "daily_summary",
            idempotencyKey: `daily-summary:${member.userId}:${day}`,
            payload: { recipientUserId: member.userId, message },
          });
          if (result.queued) queued += 1;
          else duplicates += 1;
        }
      }
      return { queued, duplicates };
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
          grouped.content = [
            ...(grouped.content ?? [{ type: grouped.type, payload: {} }]),
            { type: event.type, payload: event.payload },
          ].slice(0, 32);
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
          content: [{ type: event.type, payload: event.payload }],
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
      for (const failed of await deps.store.listUnrecoveredSms(type))
        await recoverSms(failed);
      const due = await deps.store.claimDeliveries(
        deps.now().toISOString(),
        type,
        limit,
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
          const lastAttempt = Math.max(
            ...prior.map((row) => Date.parse(row.at)),
          );
          if (lastAttempt + rule.delayMinutes * 60_000 > asOf.getTime())
            continue;
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
          const phone = verifiedPhone(backup, deps.now());
          const channel =
            rule.smsEnabled && phone
              ? "sms"
              : rule.emailEnabled
                ? "email"
                : null;
          if (!channel) continue;
          if (!people.some((person) => person.userId === backup.userId))
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
            channel,
            status: "pending",
            attempts: 0,
            nextAttemptAt: deps.now().toISOString(),
            destination: channel === "sms" ? phone : backup.email,
            simulated: note.simulated,
            idempotencyKey: `${note.id}:${backup.userId}:escalation:${prior.length + 1}`,
            createdAt: deps.now().toISOString(),
            updatedAt: deps.now().toISOString(),
          };
          if (!(await deps.store.saveDelivery(delivery, true))) continue;
          await deps.store.addEscalationAttempt({
            organizationId,
            notificationId: note.id,
            recipientUserId: backup.userId,
            outcome: "backup_notified",
            at: asOf.toISOString(),
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
      const org = await deps.loadOrg(organizationId);
      const member = (await deps.listMembers(organizationId)).find(
        (m) => m.userId === userId,
      );
      if (!org || !member) return [];
      const prefs = await prefsFor(org, member);
      return notes
        .map((note) => localized(note, org, prefs.language))
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
      const org = await deps.loadOrg(organizationId);
      const member = (await deps.listMembers(organizationId)).find(
        (m) => m.userId === userId,
      );
      if (!org || !member)
        throw new NotificationError("Notification not found.", 404);
      const prefs = await prefsFor(org, member);
      return {
        notification: localized(note, org, prefs.language),
        recipient,
        deliveries,
        escalation,
      };
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
      if (!quietHours.safeParse(row).success)
        throw new NotificationError("Invalid quiet hours.");
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

    async listEscalationContacts(
      organizationId: string,
    ): Promise<EscalationContact[]> {
      return (await deps.listMembers(organizationId))
        .map((member) => ({
          userId: member.userId,
          name: member.name?.trim() || member.email,
          role: member.role,
          verifiedPhoneE164: verifiedPhone(member, deps.now()),
        }))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
        );
    },

    async saveEscalation(rule: EscalationRule) {
      const contacts = await this.listEscalationContacts(rule.organizationId);
      for (const id of [rule.primaryUserId, rule.secondaryUserId]) {
        if (id && !contacts.some((contact) => contact.userId === id))
          throw new NotificationError(
            "Choose a current employee of this business.",
            400,
            "contactUnavailable",
          );
      }
      if (rule.primaryUserId && rule.primaryUserId === rule.secondaryUserId)
        throw new NotificationError(
          "Choose different primary and backup employees.",
          400,
          "sameContact",
        );
      const primary = contacts.find(
        (contact) => contact.userId === rule.primaryUserId,
      );
      const backup = contacts.find(
        (contact) => contact.userId === rule.secondaryUserId,
      );
      if (
        rule.enabled &&
        rule.smsEnabled &&
        !rule.emailEnabled &&
        [primary, backup].some(
          (contact) => contact && !contact.verifiedPhoneE164,
        )
      )
        throw new NotificationError(
          "SMS-only contacts need verified phone numbers. Enable email or choose another employee.",
          400,
          "smsNeedsVerifiedPhones",
        );
      // Discard a client-supplied phone; the selected member is authoritative.
      rule.secondaryPhoneE164 = backup?.verifiedPhoneE164;
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

    async applyProviderStatus(sid: string, status: string, errorCode?: string) {
      const delivery = await deps.store.applySmsStatus(
        sid,
        status,
        errorCode,
        deps.now().toISOString(),
      );
      if (!delivery) return false;
      await recoverSms(delivery);
      return true;
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
