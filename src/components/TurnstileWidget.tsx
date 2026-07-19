"use client";

import { useEffect, useId, useRef, useState } from "react";
import Script from "next/script";

type TurnstileWindow = Window & {
  turnstile?: {
    render: (
      container: HTMLElement,
      options: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      }
    ) => string;
    remove: (widgetId: string) => void;
  };
};

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Renders a Cloudflare Turnstile challenge and reports the resulting token
// via onToken. If NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't configured yet, this
// renders nothing and immediately reports a placeholder token — the server
// route treats an unconfigured secret the same way (skips verification with
// a warning log) so the form still works end-to-end before Turnstile is set up.
export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const containerId = useId();
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!SITE_KEY) {
      onToken("unconfigured");
      return;
    }
    if (!scriptLoaded) return;

    const container = document.getElementById(containerId);
    const turnstile = (window as TurnstileWindow).turnstile;
    if (!container || !turnstile) return;

    const widgetId = turnstile.render(container, {
      sitekey: SITE_KEY,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
    widgetIdRef.current = widgetId;

    return () => {
      if (widgetIdRef.current) turnstile.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded, containerId]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        onLoad={() => setScriptLoaded(true)}
      />
      <div id={containerId} />
    </>
  );
}
