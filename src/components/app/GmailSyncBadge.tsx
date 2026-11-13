"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createPoller } from "@/lib/client/poller";
import { ApiError, requestJson } from "@/lib/client/request";
import type { GmailPublicStatus } from "@/product/gmail/types";

/** Fired on `window` after a sync or a read-state change; carries `{ status }`. */
export const GMAIL_EVENT = "tradecatch:gmail";

const POLL_MS = 60_000;
const MIN_GAP_MS = 20_000;
/** The first background sync waits this long after the page loads. */
const FIRST_SYNC_DELAY_MS = 1_000;

type SyncBody = { ok?: boolean; added?: number; status?: GmailPublicStatus };

/**
 * The one place that keeps Gmail fresh while the app is open: a throttled
 * background sync every minute, paused in hidden tabs. It also owns the
 * unread badge in the navigation. The server refuses to hit Google more than
 * once per ~45s per mailbox however many tabs are open, and nothing here runs
 * for people who have not connected Gmail.
 */
export function GmailSyncBadge() {
  const t = useTranslations("app.gmail");
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let signature = "";

    // Shows what the server said about the mailbox. A throttled or failed sync
    // still carries the status, so it is applied either way.
    function apply(body: SyncBody) {
      const status = body.status;
      if (!status || status.status === "not_connected") {
        // Nothing to poll for until the person connects Gmail (that reloads the page).
        poller.stop();
        setUnread(0);
        return;
      }
      setUnread(status.unread);
      const next = `${status.status}|${status.lastError}|${status.unread}`;
      const changed = Boolean(signature) && next !== signature;
      signature = next;
      // A successful empty sync still updates the visible freshness time.
      window.dispatchEvent(new CustomEvent(GMAIL_EVENT, { detail: body }));
      if ((body.added ?? 0) > 0 || changed) {
        router.refresh();
      }
    }

    // A POST, but background work: it must not pile up or hammer a throttled
    // mailbox. The poller keeps one in flight, spaces runs by at least
    // MIN_GAP_MS, pauses in hidden tabs, and backs off after a failure or a 429
    // (see src/lib/client/poller.ts).
    const poller = createPoller(
      async (signal) => {
        try {
          apply(
            await requestJson<SyncBody>("/api/app/gmail/sync?mode=auto", {
              method: "POST",
              signal,
              retries: 0,
            }),
          );
        } catch (error) {
          const answered =
            error instanceof ApiError
              ? (error.body as SyncBody | undefined)
              : undefined;
          if (answered?.status) apply(answered);
          // 401 ends the poller; anything else (offline, restarting, throttled)
          // is tried again after a backoff.
          throw error;
        }
      },
      { intervalMs: POLL_MS, minGapMs: MIN_GAP_MS },
    );

    function onGmailEvent(event: Event) {
      const status = (event as CustomEvent<SyncBody>).detail?.status;
      if (status) setUnread(status.unread);
    }

    // A page load does not begin with a POST: the first background sync waits a
    // moment, so someone who opens the inbox and presses Refresh straight away
    // is answered by that press (and told how many emails it brought), not
    // beaten to it by this one.
    poller.start();
    const first = window.setTimeout(() => poller.poke(), FIRST_SYNC_DELAY_MS);
    window.addEventListener(GMAIL_EVENT, onGmailEvent);
    return () => {
      window.clearTimeout(first);
      poller.stop();
      window.removeEventListener(GMAIL_EVENT, onGmailEvent);
    };
  }, [router]);

  if (unread <= 0) return null;
  return (
    <span
      className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-orange px-1.5 text-xs font-semibold text-navy"
      title={t("unreadCount", { count: unread })}
      data-testid="gmail-unread-badge"
    >
      <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
      <span className="sr-only">{t("unreadCount", { count: unread })}</span>
    </span>
  );
}
