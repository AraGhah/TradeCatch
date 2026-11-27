"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { FeedbackMessage } from "@/components/ui/FeedbackMessage";
import { InlineStatus } from "@/components/ui/Spinner";

/**
 * Shown on the billing page when the customer comes back from Stripe's checkout
 * but TradeCatch has not yet recorded the payment. Stripe tells our server by
 * webhook, which normally lands within seconds; until it does, the page must not
 * say "paid" (it does not know) and must not offer to pay again.
 *
 * It re-reads the page from the server every few seconds for about a minute. The
 * server renders the real state, so "confirmed" appears only when the server says
 * so, and this component then disappears. If the confirmation is late it says so
 * and offers to check again. Nothing here writes anything: re-reading is safe.
 */

export const CHECK_EVERY_MS = 4_000;
/** About a minute of checking, then it stops and says so instead of spinning for ever. */
export const MAX_CHECKS = 15;

export function CheckoutReturnWatcher() {
  const t = useTranslations("app.account");
  const router = useRouter();
  const [checks, setChecks] = useState(0);
  const [reading, startReading] = useTransition();
  const gaveUp = checks >= MAX_CHECKS;

  useEffect(() => {
    if (gaveUp) return;
    const timer = window.setTimeout(() => {
      startReading(() => router.refresh());
      setChecks((n) => n + 1);
    }, CHECK_EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [checks, gaveUp, router]);

  if (gaveUp) {
    return (
      <FeedbackMessage
        tone="info"
        testId="checkout-confirmation-slow"
        retrying={reading}
        onRetry={() => {
          startReading(() => router.refresh());
          setChecks(0);
        }}
      >
        {t("checkoutConfirmingSlow")}
      </FeedbackMessage>
    );
  }
  return (
    <div className="flex flex-col gap-1" aria-busy="true" data-testid="checkout-confirming">
      <InlineStatus>{t("checkoutConfirming")}</InlineStatus>
      <p className="m-0 text-sm text-navy/70">{t("checkoutConfirmingNote")}</p>
    </div>
  );
}
