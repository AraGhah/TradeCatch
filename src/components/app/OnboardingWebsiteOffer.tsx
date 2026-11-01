"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { WebsiteServiceNewRequest } from "@/components/app/WebsiteServiceNewRequest";
import type { WebsiteRequestFormProps } from "@/components/WebsiteRequestForm";

/**
 * Optional card on the onboarding page. A customer can ask for the website
 * service while setting up, without anything being added to their
 * subscription: submitting only records a request (source "onboarding").
 */
export function OnboardingWebsiteOffer({
  defaults,
}: {
  defaults: WebsiteRequestFormProps["defaults"];
}) {
  const t = useTranslations("app.onboarding.website");
  const [open, setOpen] = useState(false);
  const panelId = "onboarding-website-offer";

  return (
    <section
      aria-labelledby={`${panelId}-title`}
      className="rounded-md border border-navy/10 bg-white px-5 py-5"
    >
      <h2 id={`${panelId}-title`} className="text-lg font-semibold text-navy">
        {t("title")}
      </h2>
      <p className="mt-1 max-w-[44em] text-sm text-navy/70">{t("body")}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="mt-3 rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-navy hover:bg-navy/5"
      >
        {open ? t("close") : t("open")}
      </button>
      <div id={panelId} hidden={!open} className="mt-5">
        {open ? (
          <WebsiteServiceNewRequest source="onboarding" defaults={defaults} />
        ) : null}
      </div>
    </section>
  );
}
