"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, requestJson } from "@/lib/client/request";
import { useCooldown, useSingleFlight } from "@/lib/client/use-single-flight";
import { isStripeCheckoutUrl } from "@/product/saas/billing-access";

export function InstallationCheckoutButton({
  websitePrice,
}: {
  /** The formatted website service price. The option is shown only when it is passed. */
  websitePrice?: string;
}) {
  const t = useTranslations("app.account");
  // One checkout at a time: a double click must not create two Stripe sessions.
  // The server also refuses a second pending checkout; this keeps the person
  // from ever seeing that refusal.
  const flight = useSingleFlight();
  const cooldown = useCooldown();
  // Stays true once the person is on their way to Stripe, so the button cannot
  // be clicked again while the browser navigates.
  const [redirecting, setRedirecting] = useState(false);
  // Never ticked for the customer: the website service is charged only when this is chosen.
  const [websiteService, setWebsiteService] = useState(false);
  const [error, setError] = useState<
    "checkoutError" | "checkoutPending" | "requestsLimited" | "requestsBlocked" | null
  >(null);
  const opening = flight.pending || redirecting;
  async function start() {
    await flight.run(async () => {
      setError(null);
      try {
        const body = await requestJson<{ url?: string }>("/api/billing/checkout", {
          method: "POST",
          body: { websiteService },
          // Never repeated automatically: this creates something to pay for.
          retries: 0,
        });
        if (!isStripeCheckoutUrl(body?.url)) {
          setError("checkoutError");
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
          (cause.body as { code?: string } | undefined)?.code === "already_pending"
        ) {
          setError("checkoutPending");
        } else {
          setError("checkoutError");
        }
      }
    });
  }
  return (
    <div className="flex flex-col items-start gap-2">
      {websitePrice ? (
        <label className="flex max-w-md items-start gap-2 text-sm text-navy">
          <input
            type="checkbox"
            className="mt-1"
            checked={websiteService}
            disabled={opening}
            onChange={(event) => setWebsiteService(event.target.checked)}
          />
          <span>
            {t("checkoutWebsiteLabel", { price: websitePrice })}
            <span className="mt-0.5 block text-xs text-navy/70">
              {t("checkoutWebsiteNote")}
            </span>
          </span>
        </label>
      ) : null}
      <button
        type="button"
        disabled={opening || cooldown.secondsLeft > 0}
        aria-busy={opening}
        className="rounded-md bg-orange px-3 py-2 text-sm font-semibold text-navy disabled:opacity-60"
        onClick={() => void start()}
      >
        {opening ? t("checkoutOpening") : t("checkoutStart")}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-navy">
          {t(error, { seconds: cooldown.secondsLeft || 1 })}
        </p>
      ) : null}
    </div>
  );
}
