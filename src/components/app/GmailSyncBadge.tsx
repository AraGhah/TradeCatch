"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { GmailPublicStatus } from "@/product/gmail/types";

/** Fired on `window` after a sync or a read-state change; carries `{ status }`. */
export const GMAIL_EVENT = "tradecatch:gmail";

const POLL_MS = 60_000;
const MIN_GAP_MS = 20_000;

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
    let stopped = false;
    let lastRun = 0;
    let signature = "";

    async function tick() {
      if (stopped || document.visibilityState === "hidden") return;
      if (Date.now() - lastRun < MIN_GAP_MS) return;
      lastRun = Date.now();
      try {
        const response = await fetch("/api/app/gmail/sync?mode=auto", {
          method: "POST",
          cache: "no-store",
        });
        if (response.status === 401) {
          stopped = true;
          return;
        }
        const body = (await response.json()) as SyncBody;
        const status = body.status;
        if (!status || status.status === "not_connected") {
          // Nothing to poll for until the person connects Gmail (that reloads the page).
          stopped = true;
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
      } catch {
        // Offline or the server is restarting: the next tick tries again.
      }
    }

    function onGmailEvent(event: Event) {
      const status = (event as CustomEvent<SyncBody>).detail?.status;
      if (status) setUnread(status.unread);
    }
    function onVisible() {
      if (document.visibilityState === "visible") void tick();
    }

    const first = window.setTimeout(() => void tick(), 1_000);
    const timer = window.setInterval(() => void tick(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(GMAIL_EVENT, onGmailEvent);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
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
