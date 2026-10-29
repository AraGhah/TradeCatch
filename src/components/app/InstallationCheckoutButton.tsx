"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isStripeCheckoutUrl } from "@/product/saas/billing-access";

export function InstallationCheckoutButton() {
  const t = useTranslations("app.account");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setOpening(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
      });
      const body = (await response.json()) as { url?: string; code?: string };
      if (!response.ok || !isStripeCheckoutUrl(body.url)) {
        setError(body.code === "already_pending" ? "checkoutPending" : "checkoutError");
        setOpening(false);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("checkoutError");
      setOpening(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={opening}
        aria-busy={opening}
        className="rounded-md bg-orange px-3 py-2 text-sm font-semibold text-navy disabled:opacity-60"
        onClick={() => void start()}
      >
        {opening ? t("checkoutOpening") : t("checkoutStart")}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-navy">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
