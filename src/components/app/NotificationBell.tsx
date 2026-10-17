"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

export function NotificationBell({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.alerts");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stop = false;
    let ctrl: AbortController | null = null;
    async function load() {
      if (document.visibilityState === "hidden") return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`/api/businesses/${organizationId}/notifications/unread-count`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!stop) setCount(data.count ?? 0);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      ctrl?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [organizationId]);

  return (
    <Link
      href="/app/notifications"
      className="relative rounded-md px-3 py-2 text-navy hover:bg-navy/5"
      aria-label={t("headline")}
    >
      {t("headline")}
      {count > 0 ? (
        <span className="ml-1 rounded-full bg-red-700 px-1.5 text-xs text-white">{count}</span>
      ) : null}
    </Link>
  );
}
