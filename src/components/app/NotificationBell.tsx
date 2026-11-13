"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { createPoller } from "@/lib/client/poller";
import { requestJson } from "@/lib/client/request";

/** Fired on `window` whenever notifications are read or acknowledged. */
export const NOTIFICATIONS_CHANGED = "tradecatch:notifications-changed";

export function NotificationBell({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.alerts");
  const [count, setCount] = useState(0);

  useEffect(() => {
    const poller = createPoller(
      async (signal) => {
        const data = await requestJson<{ count?: number }>(
          `/api/businesses/${organizationId}/notifications/unread-count`,
          { signal, retries: 0 },
        );
        if (!signal.aborted) setCount(data.count ?? 0);
      },
      // The bell sits on every page, so it is the busiest poller: spread it,
      // back it off, pause it in hidden tabs (src/lib/client/poller.ts).
      { intervalMs: 20_000, minGapMs: 1_000 },
    );
    poller.start({ immediate: true });
    // The notifications page says when something was read or acknowledged,
    // so the count follows at once instead of at the next poll.
    const onChanged = () => poller.poke();
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      poller.stop();
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [organizationId]);

  return (
    <Link
      href="/app/notifications"
      className="relative rounded-md px-3 py-2 text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)]"
      aria-label={t("headline")}
    >
      {t("headline")}
      {count > 0 ? (
        <span className="ml-1 rounded-full bg-red-700 px-1.5 text-xs text-white">{count}</span>
      ) : null}
    </Link>
  );
}
