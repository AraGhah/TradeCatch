"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { GMAIL_EVENT } from "@/components/app/GmailSyncBadge";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

async function setRead(id: string, read: boolean) {
  const response = await fetch(`/api/app/gmail/messages/${encodeURIComponent(id)}/read`, {
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
  const [isUnread, setIsUnread] = useState(unread);
  const [busy, setBusy] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    if (!unread || marked.current) return;
    marked.current = true;
    void setRead(id, true).then((result) => {
      if (result !== null) setIsUnread(false);
    });
  }, [id, unread]);

  async function toggle() {
    setBusy(true);
    const nextRead = isUnread;
    const result = await setRead(id, nextRead);
    if (result !== null) setIsUnread(!nextRead);
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className={`rounded-md border border-navy/25 px-3 py-1.5 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-60 ${FOCUS_RING}`}
        data-testid="gmail-toggle-read"
      >
        {isUnread ? t("markRead") : t("markUnread")}
      </button>
      <span className="text-xs text-navy/70" data-testid="gmail-read-state">
        {isUnread ? t("unread") : t("read")}
      </span>
    </div>
  );
}
