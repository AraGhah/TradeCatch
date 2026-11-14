"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, requestJson } from "@/lib/client/request";
import { useCooldown, useSingleFlight } from "@/lib/client/use-single-flight";
import { isStripePortalUrl } from "@/product/saas/billing-access";

export function BillingPortalButton() {
  const t = useTranslations("app.account");
  const locale = useLocale();
  const flight = useSingleFlight();
  const cooldown = useCooldown();
  // Stays true once the person is on their way to Stripe (no second click while navigating).
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<
    "not_linked" | "unavailable" | "requestsLimited" | "requestsBlocked" | null
  >(null);
  const opening = flight.pending || redirecting;
  async function open() {
    await flight.run(async () => {
      setError(null);
      try {
        const body = await requestJson<{ url?: string }>("/api/billing/portal", {
          method: "POST",
          body: { locale },
          retries: 0,
        });
        if (!isStripePortalUrl(body?.url)) {
          setError("unavailable");
          return;
        }
        setRedirecting(true);
        window.location.assign(body.url);
      } catch (cause) {
        if (cause instanceof ApiError && cause.kind === "rate_limited") {
          cooldown.start(cause.retryAfterMs ?? 5_000);
          setError("requestsLimited");
        } else if (cause instanceof ApiError && cause.kind === "blocked") {
          setError("requestsBlocked");
        } else if (
          cause instanceof ApiError &&
          (cause.body as { code?: string } | undefined)?.code === "not_linked"
        ) {
          setError("not_linked");
        } else {
          setError("unavailable");
        }
      }
    });
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={opening || cooldown.secondsLeft > 0}
        aria-busy={opening}
        className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        onClick={() => void open()}
      >
        {opening ? t("billingOpening") : t("billing")}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-navy">
          {error === "not_linked"
            ? t("billingMissing")
            : error === "requestsLimited"
              ? t("requestsLimited", { seconds: cooldown.secondsLeft || 1 })
              : error === "requestsBlocked"
                ? t("requestsBlocked")
                : t("billingError")}
        </p>
      ) : null}
    </div>
  );
}
