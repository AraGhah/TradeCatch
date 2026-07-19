"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const STORAGE_KEY = "tradecatch-cookie-consent";

export function CookieConsent() {
  const t = useTranslations("cookieBanner");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Reading localStorage requires the client mount; can't be done during SSR render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(!localStorage.getItem(STORAGE_KEY));
  }, []);

  function decide(value: "accepted" | "declined") {
    localStorage.setItem(STORAGE_KEY, value);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-navy/10 bg-white/98 p-4 shadow-[0_-4px_16px_rgba(18,32,51,0.12)]">
      <div className="mx-auto flex max-w-(--container-page) flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text/80">
          {t("text")}{" "}
          <Link href="/cookie-policy" className="underline underline-offset-2">
            →
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("declined")}
            className="rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-navy"
          >
            {t("decline")}
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
