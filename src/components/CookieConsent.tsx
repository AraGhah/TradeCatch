"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  MANAGE_COOKIES_EVENT,
  readConsent,
  writeConsent,
} from "@/lib/analytics";

const BUTTON_BASE =
  "rounded-md px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2 sm:px-4 sm:text-sm";

export function CookieConsent() {
  const t = useTranslations("cookieBanner");
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function applyOffset(px: number) {
      document.documentElement.style.setProperty(
        "--tc-cookie-offset",
        `${Math.max(0, Math.ceil(px))}px`,
      );
      document.body.style.paddingBottom =
        "calc(var(--tc-cookie-offset, 0px) + var(--tc-sticky-cta-offset, 0px))";
    }

    if (!visible) {
      applyOffset(0);
      return () => applyOffset(0);
    }

    const el = bannerRef.current;
    if (!el) {
      applyOffset(96);
      return () => applyOffset(0);
    }

    const measure = () => applyOffset(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      applyOffset(0);
    };
  }, [visible, expanded]);

  useEffect(() => {
    if (!visible) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      writeConsent(false, t("rejectNonEssential"));
      setVisible(false);
      setExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, t]);

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
    <div
      ref={bannerRef}
      role="region"
      aria-label={t("managePreferences")}
      className="animate-tc-in fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto border-t border-[rgb(var(--ink-rgb)/0.1)] bg-surface/98 p-3 shadow-[0_-4px_16px_rgb(var(--ink-rgb)/0.12)] sm:p-4"
    >
      <div className="mx-auto max-w-(--container-page)">
        <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="text-[13px] leading-snug text-text/80 sm:text-sm">
            {t("text")}{" "}
            <Link
              href="/cookie-policy"
              className="underline underline-offset-2"
            >
              {t("policyLink")}
            </Link>
            {/* Phones: a text link keeps the banner to one row of buttons. */}
            <span className="sm:hidden">
              {" · "}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="font-semibold text-heading underline underline-offset-2"
              >
                {t("managePreferences")}
              </button>
            </span>
          </p>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`${BUTTON_BASE} hidden border border-[rgb(var(--ink-rgb)/0.2)] text-heading hover:border-[rgb(var(--ink-rgb)/0.4)] sm:inline-flex`}
            >
              {t("managePreferences")}
            </button>
            <button
              type="button"
              onClick={rejectNonEssential}
              className={`${BUTTON_BASE} border border-[rgb(var(--ink-rgb)/0.2)] text-heading hover:border-[rgb(var(--ink-rgb)/0.4)]`}
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
          <div className="mt-4 space-y-3 border-t border-[rgb(var(--ink-rgb)/0.1)] pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-heading">
                  {t("essentialLabel")}
                </p>
                <p className="text-xs text-text/70">
                  {t("essentialDescription")}
                </p>
              </div>
              <input
                type="checkbox"
                checked
                disabled
                aria-label={t("essentialLabel")}
                className="mt-1 h-4 w-4 shrink-0 rounded border-[rgb(var(--ink-rgb)/0.3)] accent-navy/50"
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-heading">
                  {t("analyticsLabel")}
                </p>
                <p className="text-xs text-text/70">
                  {t("analyticsDescription")}
                </p>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                aria-label={t("analyticsLabel")}
                className="mt-1 h-4 w-4 shrink-0 rounded border-[rgb(var(--ink-rgb)/0.3)] accent-orange"
              />
            </div>
            <button
              type="button"
              onClick={savePreferences}
              className={`${BUTTON_BASE} w-full bg-navy text-white hover:bg-navy/90 sm:w-auto`}
            >
              {t("savePreferences")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
