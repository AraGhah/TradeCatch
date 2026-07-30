"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
    reset: (widgetId: string) => void;
  };
};

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Renders a Cloudflare Turnstile challenge and reports the resulting token
// via onToken. If NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't configured yet, this
// renders nothing and immediately reports a placeholder token — the server
// route treats an unconfigured secret the same way (skips verification with
// a warning log) so the form still works end-to-end before Turnstile is set up.
export type TurnstileWidgetHandle = {
  reset: () => void;
};

export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  { onToken: (token: string) => void }
>(function TurnstileWidget({ onToken }, ref) {
  const containerId = useId();
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [scriptReady, setScriptReady] = useState(false);
  onTokenRef.current = onToken;

  useImperativeHandle(ref, () => ({
    reset() {
      const turnstile = (window as TurnstileWindow).turnstile;
      if (turnstile && widgetIdRef.current) {
        turnstile.reset(widgetIdRef.current);
      }
      onTokenRef.current("");
    },
  }), []);

  useEffect(() => {
    if (!SITE_KEY) {
      onTokenRef.current("unconfigured");
      return;
    }
    if (!scriptReady) return;

    let cancelled = false;
    let retryId: number | undefined;

    const renderWhenReady = () => {
      if (cancelled || widgetIdRef.current) return;
      const container = document.getElementById(containerId);
      const turnstile = (window as TurnstileWindow).turnstile;
      if (!container || !turnstile) {
        retryId = window.setTimeout(renderWhenReady, 50);
        return;
      }

      widgetIdRef.current = turnstile.render(container, {
        sitekey: SITE_KEY,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current(""),
      });
    };
    renderWhenReady();

    return () => {
      cancelled = true;
      if (retryId) window.clearTimeout(retryId);
      const turnstile = (window as TurnstileWindow).turnstile;
      if (widgetIdRef.current && turnstile) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [scriptReady, containerId]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        onReady={() => setScriptReady(true)}
      />
      <div id={containerId} />
    </>
  );
});
