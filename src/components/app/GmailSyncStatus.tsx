"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GMAIL_EVENT } from "./GmailSyncBadge";
import type { GmailPublicStatus } from "@/product/gmail/types";

export function GmailSyncStatus({
  lastSyncAt,
  pushEnabled = false,
  pushConfigured = false,
}: {
  lastSyncAt: string | null;
  pushEnabled?: boolean;
  pushConfigured?: boolean;
}) {
  const t = useTranslations("app.gmail");
  const locale = useLocale();
  const [current, setCurrent] = useState({
    lastSyncAt,
    pushEnabled,
    pushConfigured,
  });
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const status = (event as CustomEvent<{ status?: GmailPublicStatus }>)
        .detail?.status;
      if (status) setCurrent(status);
    };
    window.addEventListener(GMAIL_EVENT, update);
    return () => window.removeEventListener(GMAIL_EVENT, update);
  }, []);
  const valid =
    current.lastSyncAt && Number.isFinite(Date.parse(current.lastSyncAt));
  const when = valid
    ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Toronto",
      }).format(new Date(current.lastSyncAt!))
    : null;
  return (
    <div className="mt-1 text-sm text-navy/70" aria-live="polite">
      <p data-testid="gmail-last-successful-sync">
        {when ? (
          <time dateTime={current.lastSyncAt!}>{t("lastSync", { when })}</time>
        ) : (
          t("neverSynced")
        )}
      </p>
      <p className="mt-1" data-testid="gmail-sync-mode">
        {t(
          current.pushEnabled
            ? "pushActive"
            : current.pushConfigured
              ? "pushPending"
              : "pollingFallback",
        )}
      </p>
      {now !== null &&
        (!valid || now - Date.parse(current.lastSyncAt!) > 15 * 60_000) && (
          <p className="mt-1 text-amber-800" data-testid="gmail-sync-delayed">
            {t("syncDelayed")}
          </p>
        )}
    </div>
  );
}
