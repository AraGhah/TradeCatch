"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isStripePortalUrl } from "@/product/saas/billing-access";

export function BillingPortalButton() {
  const t = useTranslations("app.account");
  const locale = useLocale();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<"not_linked" | "unavailable" | null>(null);
  async function open() {
    setOpening(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ locale }),
      });
      const body = (await response.json()) as { url?: string; code?: string };
      if (!response.ok || !isStripePortalUrl(body.url)) {
        setError(body.code === "not_linked" ? "not_linked" : "unavailable");
        setOpening(false);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("unavailable");
      setOpening(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={opening}
        aria-busy={opening}
        className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        onClick={() => void open()}
      >
        {opening ? t("billingOpening") : t("billing")}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-navy">
          {t(error === "not_linked" ? "billingMissing" : "billingError")}
        </p>
      ) : null}
    </div>
  );
}
