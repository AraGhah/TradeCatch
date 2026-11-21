"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SetPasswordForm } from "@/components/app/SetPasswordForm";
import { Link } from "@/i18n/navigation";
import { timedFetch } from "@/lib/client/timed-fetch";
import {
  moveTokenToFragment,
  readPasswordLinkToken,
} from "@/lib/client/password-link";

type Phase =
  | { name: "checking" }
  | { name: "ready"; token: string; kind: "activation" | "reset" }
  | { name: "invalid" }
  | { name: "unavailable" }
  | { name: "limited" };

const buttonClass =
  "inline-block rounded-md bg-orange px-5 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark";

/**
 * The whole set-password page body. The link's secret is read here, in the
 * browser, from the part of the address a server never receives, checked once
 * without spending it, and only then offered the form. A link that cannot be
 * used gets the plain explanation and a way to ask for a new one; a check that
 * could not run is never reported as an expired link.
 */
export function SetPasswordFlow() {
  const t = useTranslations("setPassword");
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const [attempt, setAttempt] = useState(0);

  // Pasting a newer link into the tab that is already open only changes the
  // fragment, which the browser treats as the same page: check the new link
  // instead of leaving the result for the old one on screen.
  useEffect(() => {
    const onHashChange = () => {
      setPhase({ name: "checking" });
      setAttempt((n) => n + 1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // The address fragment exists only in the browser, so it cannot be read
    // during the server-matching first render: this one-time mount read is the
    // legitimate exception to "no setState in effects".
    const link = readPasswordLinkToken(window.location);
    if (!link) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase({ name: "invalid" });
      return;
    }
    if (link.fromQuery) moveTokenToFragment(link.token);

    const controller = new AbortController();
    (async () => {
      try {
        const res = await timedFetch("/api/auth/set-password/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: link.token }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 429) {
          setPhase({ name: "limited" });
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          valid?: boolean;
          kind?: string;
        } | null;
        // The link may have changed (or the page been left) while this ran.
        if (controller.signal.aborted) return;
        if (res.ok && data?.valid === true) {
          setPhase({
            name: "ready",
            token: link.token,
            kind: data.kind === "activation" ? "activation" : "reset",
          });
        } else if (res.ok && data?.valid === false) {
          setPhase({ name: "invalid" });
        } else {
          setPhase({ name: "unavailable" });
        }
      } catch {
        if (!controller.signal.aborted) setPhase({ name: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const headline =
    phase.name === "ready" && phase.kind === "activation"
      ? t("headlineActivation")
      : phase.name === "invalid"
        ? t("headlineInvalid")
        : t("headlineReset");

  return (
    <>
      <div className="mx-auto max-w-lg text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-ember-text">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-archivo)] text-3xl font-extrabold tracking-tight text-navy md:text-4xl">
          {headline}
        </h1>
        {phase.name === "checking" ? (
          <p className="mt-3 text-base text-navy/70" role="status">
            {t("checking")}
          </p>
        ) : null}
        {phase.name === "ready" ? (
          <p className="mt-3 text-base text-navy/70">
            {phase.kind === "activation" ? t("introActivation") : t("introReset")}
          </p>
        ) : null}
        {phase.name === "invalid" ? (
          <p className="mt-3 text-base text-navy/70" role="alert">
            {t("invalidLink")}
          </p>
        ) : null}
        {phase.name === "unavailable" ? (
          <p className="mt-3 text-base text-navy/70" role="alert">
            {t("checkFailed")}
          </p>
        ) : null}
        {phase.name === "limited" ? (
          <p className="mt-3 text-base text-navy/70" role="alert">
            {t("rateLimited")}
          </p>
        ) : null}
      </div>
      <div className="mt-10">
        {phase.name === "ready" ? (
          <SetPasswordForm
            token={phase.token}
            onInvalid={() => setPhase({ name: "invalid" })}
          />
        ) : null}
        {phase.name === "invalid" ? (
          <p className="text-center">
            <Link href="/forgot-password" className={buttonClass}>
              {t("requestNew")}
            </Link>
          </p>
        ) : null}
        {phase.name === "unavailable" || phase.name === "limited" ? (
          <p className="text-center">
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setPhase({ name: "checking" });
                setAttempt((n) => n + 1);
              }}
            >
              {t("retry")}
            </button>
          </p>
        ) : null}
      </div>
    </>
  );
}
