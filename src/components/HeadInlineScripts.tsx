"use client";

import { useServerInsertedHTML } from "next/navigation";

const CONSENT_DEFAULT_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});`;

// Runs before paint so a returning visitor's saved theme never flashes light
// then dark. Purely manual (localStorage), independent of prefers-color-scheme.
const THEME_INIT_SCRIPT = `try{if(localStorage.getItem('tc-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`;

/**
 * Inject JSON-LD + gtag consent defaults into the SSR HTML stream outside the
 * React client tree — avoids React 19's "script tag while rendering" error.
 */
export function HeadInlineScripts({
  nonce,
  organizationJsonLd,
}: {
  nonce?: string;
  organizationJsonLd: string;
}) {
  useServerInsertedHTML(() => (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: organizationJsonLd }}
      />
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: CONSENT_DEFAULT_SCRIPT }}
      />
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
      />
    </>
  ));

  return null;
}
