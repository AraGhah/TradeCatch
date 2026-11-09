/**
 * Retry owner notifications that failed in a way a retry can fix.
 *
 * Finalizing a call claims it once and records every delivery on the call. This
 * job only ever re-sends a recipient whose latest attempt failed with
 * `retryable: true`; a recipient that already succeeded, was refused for good
 * (bad number), or whose outcome is unknown (the provider may have delivered)
 * is never sent again. Each attempt is claimed with the call's version number,
 * so two overlapping runs cannot both send.
 */

import { isConflictError, type ReceptionistStore } from "./store";
import { activeChannels, maskDestination, type ReceptionistNotifier } from "./notifications";
import type {
  CallSession,
  NotificationChannel,
  NotificationDelivery,
  ReceptionistConfig,
} from "./types";

/** First delivery + three retries. */
export const MAX_NOTIFICATION_ATTEMPTS = 4;
/** Calls older than this are not retried: an owner texted about last week's call is noise. */
export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Wait after attempt n before attempt n + 1. */
const BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];

export type NotificationRetryDeps = {
  store: ReceptionistStore;
  notifier: ReceptionistNotifier;
  configFor(session: CallSession): ReceptionistConfig | undefined;
  clock?: { now(): Date };
};

export type NotificationRetryResult = {
  considered: number;
  retried: number;
  delivered: number;
  failed: number;
};

function destinationOf(channel: NotificationChannel): string {
  return channel.type === "sms"
    ? channel.toE164
    : channel.type === "email"
      ? channel.to
      : channel.url;
}

const keyOf = (channel: NotificationChannel["type"], to?: string) =>
  `${channel}|${to ?? ""}`;

/** Channels of this call that are due for another attempt right now. */
export function dueChannels(
  session: CallSession,
  config: ReceptionistConfig,
  now: Date,
): { channels: NotificationChannel[]; attempt: number } {
  const retry = session.notificationRetry;
  if (retry && retry.attempts >= MAX_NOTIFICATION_ATTEMPTS - 1)
    return { channels: [], attempt: 0 };

  const byKey = new Map<string, NotificationDelivery[]>();
  for (const d of session.notifications) {
    const k = keyOf(d.channel, d.to);
    byKey.set(k, [...(byKey.get(k) ?? []), d]);
  }

  const channels: NotificationChannel[] = [];
  let attempt = 1;
  for (const channel of activeChannels(config)) {
    const history = byKey.get(
      keyOf(channel.type, maskDestination(channel.type, destinationOf(channel))),
    );
    if (!history?.length) continue; // never attempted (e.g. emergency-only): not a retry
    if (history.some((d) => d.ok)) continue; // delivered once: never again
    const last = history.reduce((a, b) => (a.at >= b.at ? a : b));
    const attempts = Math.max(...history.map((d) => d.attempt ?? 1));
    if (last.retryable !== true || attempts >= MAX_NOTIFICATION_ATTEMPTS) continue;
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    const lastAt = Math.max(
      Date.parse(last.at),
      retry ? Date.parse(retry.lastAttemptAt) : 0,
    );
    if (now.getTime() - lastAt < wait) continue;
    channels.push(channel);
    attempt = Math.max(attempt, attempts + 1);
  }
  return { channels, attempt };
}

export function createNotificationRetryJob(deps: NotificationRetryDeps) {
  const clock = deps.clock ?? { now: () => new Date() };

  async function appendDeliveries(
    sessionId: string,
    deliveries: NotificationDelivery[],
  ): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      const latest = await deps.store.getSession(sessionId);
      if (!latest) return;
      try {
        await deps.store.saveSession({
          ...latest,
          notifications: [...latest.notifications, ...deliveries],
          updatedAt: clock.now().toISOString(),
        });
        return;
      } catch (err) {
        if (!isConflictError(err) || i === 3) throw err;
      }
    }
  }

  return {
    async run(limit = 20): Promise<NotificationRetryResult> {
      const now = clock.now();
      const result: NotificationRetryResult = {
        considered: 0,
        retried: 0,
        delivered: 0,
        failed: 0,
      };
      const candidates = await deps.store.listWithRetryableNotifications(
        new Date(now.getTime() - RETRY_WINDOW_MS).toISOString(),
        limit,
      );
      for (const session of candidates) {
        result.considered += 1;
        const config = deps.configFor(session);
        if (!config || !session.summary) continue;
        const { channels, attempt } = dueChannels(session, config, now);
        if (channels.length === 0) continue;

        // Claim this attempt. Losing the race means another run owns it.
        let claimed: CallSession;
        try {
          claimed = await deps.store.saveSession({
            ...session,
            notificationRetry: {
              attempts: (session.notificationRetry?.attempts ?? 0) + 1,
              lastAttemptAt: now.toISOString(),
            },
            updatedAt: now.toISOString(),
          });
        } catch (err) {
          if (isConflictError(err)) continue;
          throw err;
        }

        const deliveries = await deps.notifier.deliverSummary(
          { ...config, notifications: channels },
          claimed,
          claimed.summary!,
          { attempt },
        );
        await appendDeliveries(claimed.id, deliveries);
        result.retried += 1;
        for (const d of deliveries) {
          if (d.ok) result.delivered += 1;
          else result.failed += 1;
        }
      }
      return result;
    },
  };
}
