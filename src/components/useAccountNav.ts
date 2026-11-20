"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getPathname } from "@/i18n/pathname";
import {
  createAccountSession,
  type AccountSession,
  type AccountSnapshot,
} from "@/lib/client/account-session";

export type AccountNav = {
  /** For tests and styling: loading, anonymous, signed_in or unavailable. */
  state: AccountSnapshot["view"]["state"];
  /** What the control does, as words: "Login", "My dashboard", "Admin dashboard". */
  label: string;
  /** The best address known now. A real link, so new tab, copy link and no-script all work. */
  href: string;
  /** The icon was activated and the session is being verified. */
  busy: boolean;
  onActivate: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * One instance per header, shared by the icon and the mobile menu entry so the
 * page makes one session check, not one per control.
 */
export function useAccountNav(): AccountNav {
  const t = useTranslations("nav");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const loginHref = getPathname({ locale, href: "/login" });
  const [snapshot, setSnapshot] = useState<AccountSnapshot>({
    view: { state: "loading" },
    busy: false,
  });
  const sessionRef = useRef<AccountSession | null>(null);

  useEffect(() => {
    const session = createAccountSession({
      // Looked up per call so any wrapper installed on window.fetch is honoured.
      fetch: (input, init) => window.fetch(input, init),
      locale,
      loginPath: loginHref,
      navigate: (path) => window.location.assign(path),
      onChange: setSnapshot,
    });
    sessionRef.current = session;
    void session.check();

    // A page restored from the back/forward cache may show a state from before
    // the person signed in or out. Ask again, and allow the icon to be used again.
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) session.reset();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      session.stop();
      sessionRef.current = null;
    };
  }, [locale, loginHref]);

  const { view, busy } = snapshot;
  const label =
    view.state === "signed_in"
      ? view.role === "admin"
        ? t("accountAdmin")
        : view.role === "billing"
          ? t("accountBilling")
          : t("accountDashboard")
      : view.state === "anonymous"
        ? t("login")
        : t("account");
  const href =
    view.state === "signed_in" || view.state === "anonymous"
      ? view.destination
      : loginHref;

  function onActivate(event: MouseEvent<HTMLAnchorElement>) {
    // Leave new-tab and modified clicks to the browser: the link is real.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const session = sessionRef.current;
    // Not ready yet (before hydration finishes): let the plain link work.
    if (!session) return;
    event.preventDefault();
    void session.open();
  }

  return { state: view.state, label, href, busy, onActivate };
}
