"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

const SHOW_DELAY_MS = 140;
const HIDE_MS = 180;

/**
 * Thin top progress bar for genuinely delayed client navigations. Instant
 * (prefetched) transitions never show it. Clicks are never blocked; interrupted
 * navigations clear the bar when the pathname settles on the last destination.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [visible, setVisible] = useState(false);
  const navigating = useRef(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearShow() {
      if (showTimer.current) {
        clearTimeout(showTimer.current);
        showTimer.current = null;
      }
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        // Same page (hash-only or identical): nothing to wait for.
        return;
      }

      navigating.current = true;
      clearShow();
      showTimer.current = setTimeout(() => {
        if (navigating.current) setVisible(true);
      }, SHOW_DELAY_MS);
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearShow();
    };
  }, []);

  useEffect(() => {
    navigating.current = false;
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    // Finish the bar briefly, then hide — avoids a flash cut-off on completion.
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [pathname]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5"
      aria-hidden={!visible}
    >
      {visible ? (
        <p role="status" className="sr-only">
          {t("navigating")}
        </p>
      ) : null}
      <div
        data-testid="navigation-progress"
        data-active={visible ? "true" : "false"}
        className={`tc-nav-progress ${visible ? "tc-nav-progress--active" : ""}`}
      />
    </div>
  );
}
