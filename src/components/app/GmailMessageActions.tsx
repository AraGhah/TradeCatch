"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { GMAIL_EVENT } from "@/components/app/GmailSyncBadge";

import { timedFetch } from "@/lib/client/timed-fetch";
import { useGuarded } from "@/lib/client/use-single-flight";
import { BusyLabel } from "@/components/ui/Spinner";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

async function setRead(id: string, read: boolean) {
  const response = await timedFetch(`/api/app/gmail/messages/${encodeURIComponent(id)}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ read }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { unread: number };
  window.dispatchEvent(
    new CustomEvent(GMAIL_EVENT, { detail: { status: { status: "connected", unread: body.unread } } }),
  );
  return body.unread;
}

/**
 * Opening an email marks it read inside TradeCatch (a write, so it happens
 * from the browser rather than during server rendering where prefetching
 * could trigger it). The Gmail permission is read-only: Gmail itself is
 * never changed.
 */
export function GmailMessageActions({ id, unread }: { id: string; unread: boolean }) {
  const t = useTranslations("app.gmail");
  const tFeedback = useTranslations("feedback");
  const [isUnread, setIsUnread] = useState(unread);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    if (!unread || marked.current) return;
    marked.current = true;
    // Background: opening the email marks it read. A failure here is silent on
    // purpose (the person did not ask for it) and is caught so it never throws.
    void setRead(id, true)
      .then((result) => {
        if (result !== null) setIsUnread(false);
      })
      .catch(() => undefined);
  }, [id, unread]);

  // Guarded: a burst of clicks is one request. The button is released in
  // `finally`, so a dropped connection can never leave it disabled for good.
  const toggle = useGuarded(toggleHandler);
  async function toggleHandler() {
    setBusy(true);
    setFailed(false);
    const nextRead = isUnread;
    try {
      const result = await setRead(id, nextRead);
      // The label flips only once the server confirmed the new state.
      if (result !== null) setIsUnread(!nextRead);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void toggle()}
        className={`rounded-md border border-navy/25 px-3 py-1.5 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-60 ${FOCUS_RING}`}
        data-testid="gmail-toggle-read"
      >
        <BusyLabel pending={busy} busyLabel={tFeedback("saving")}>
          {isUnread ? t("markRead") : t("markUnread")}
        </BusyLabel>
      </button>
      <span className="text-xs text-navy/70" data-testid="gmail-read-state">
        {isUnread ? t("unread") : t("read")}
      </span>
      {failed ? (
        <span role="alert" className="text-xs text-red-700">
          {tFeedback("errors.network")}
        </span>
      ) : null}
    </div>
  );
}
