"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import {
  CONSENT_EVENT,
  applyConsentDefaults,
  hasAnalyticsConsent,
  updateGoogleConsent,
} from "@/lib/analytics";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function Analytics({ nonce }: { nonce?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    applyConsentDefaults();
    function sync() {
      const granted = hasAnalyticsConsent();
      updateGoogleConsent(granted);
      setEnabled(granted);
    }
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  if (!GA_MEASUREMENT_ID || !enabled) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('consent', 'update', { analytics_storage: 'granted' });
          gtag('config', '${GA_MEASUREMENT_ID}', {
            anonymize_ip: true,
            send_page_view: true
          });
        `}
      </Script>
    </>
  );
}
