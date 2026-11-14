"use client";

import { useEffect } from "react";
import { createSessionKeeper } from "@/lib/client/session-keeper";

let installed = false;

/**
 * Mounted once by every signed-in layout (workspace, admin, billing). Renews
 * the short-lived access token in the background and retries an API call once
 * after a 401, so a session survives navigation, refreshes and a sleeping
 * laptop. Renders nothing.
 */
export function SessionKeeper({
  accessExpiresAt,
  locale,
}: {
  /** Unix seconds when the current access token expires (from the server). */
  accessExpiresAt?: number;
  locale: "en" | "fr";
}) {
  useEffect(() => {
    if (installed) return;
    installed = true;
    const originalFetch = window.fetch.bind(window);
    const keeper = createSessionKeeper(
      {
        fetch: originalFetch,
        now: () => Date.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
        origin: window.location.origin,
        onSignedOut: () => {
          const login = locale === "fr" ? "/fr/connexion" : "/login";
          const here = `${window.location.pathname}${window.location.search}`;
          const back = /^\/(?:fr\/)?app(?:\/|$)/.test(window.location.pathname)
            ? `?next=${encodeURIComponent(here)}`
            : "";
          // Full navigation on purpose (drops in-memory state and the router cache); replace keeps the dead page out of history.
          window.location.replace(`${login}${back}`);
        },
      },
      accessExpiresAt,
    );
    window.fetch = keeper.fetch;

    const onVisible = () => {
      if (document.visibilityState === "visible") keeper.renewIfDue();
    };
    const onOnline = () => keeper.renewIfDue();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onOnline);

    return () => {
      keeper.stop();
      window.fetch = originalFetch;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onOnline);
      installed = false;
    };
    // The keeper tracks later expiries itself; the first value is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
