"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import {
  MANAGE_COOKIES_EVENT,
  readConsent,
  writeConsent,
} from "@/lib/analytics";

const BUTTON_BASE =
  "rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/50 focus-visible:ring-offset-2";

export function CookieConsent() {
  const t = useTranslations("cookieBanner");
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    // Reading localStorage requires the client mount; can't be done during SSR render.
    const existing = readConsent();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(!existing);
    if (existing) setAnalytics(existing.analytics);

    function reopen() {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setExpanded(true);
      setVisible(true);
    }
    window.addEventListener(MANAGE_COOKIES_EVENT, reopen);
    return () => window.removeEventListener(MANAGE_COOKIES_EVENT, reopen);
  }, []);

  function acceptAll() {
    writeConsent(true, t("acceptAll"));
    setVisible(false);
    setExpanded(false);
  }

  function rejectNonEssential() {
    writeConsent(false, t("rejectNonEssential"));
    setVisible(false);
    setExpanded(false);
  }

  function savePreferences() {
    writeConsent(analytics, t("savePreferences"));
    setVisible(false);
    setExpanded(false);
  }

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      role="dialog"
      aria-label={t("managePreferences")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy/10 bg-white/98 p-4 shadow-[0_-4px_16px_rgba(18,32,51,0.12)]"
    >
      <div className="mx-auto max-w-(--container-page)">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text/80">
            {t("text")}{" "}
            <Link href="/cookie-policy" className="underline underline-offset-2">
              →
            </Link>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`${BUTTON_BASE} border border-navy/20 text-navy hover:border-navy/40`}
            >
              {t("managePreferences")}
            </button>
            <button
              type="button"
              onClick={rejectNonEssential}
              className={`${BUTTON_BASE} border border-navy/20 text-navy hover:border-navy/40`}
            >
              {t("rejectNonEssential")}
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className={`${BUTTON_BASE} bg-orange text-navy shadow-cta hover:bg-orange-dark`}
            >
              {t("acceptAll")}
            </button>
          </div>
        </div>

        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.2 }}
            className="mt-4 space-y-3 border-t border-navy/10 pt-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-navy">{t("essentialLabel")}</p>
                <p className="text-xs text-text/70">{t("essentialDescription")}</p>
              </div>
              <input
                type="checkbox"
                checked
                disabled
                aria-label={t("essentialLabel")}
                className="mt-1 h-4 w-4 shrink-0 rounded border-navy/30 accent-navy/50"
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-navy">{t("analyticsLabel")}</p>
                <p className="text-xs text-text/70">{t("analyticsDescription")}</p>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                aria-label={t("analyticsLabel")}
                className="mt-1 h-4 w-4 shrink-0 rounded border-navy/30 accent-orange"
              />
            </div>
            <button
              type="button"
              onClick={savePreferences}
              className={`${BUTTON_BASE} w-full bg-navy text-white hover:bg-navy/90 sm:w-auto`}
            >
              {t("savePreferences")}
            </button>
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}
