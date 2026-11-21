"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BusyLabel } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { requestJson } from "@/lib/client/request";
import { useAction } from "@/lib/client/use-action";

export function ForgotPasswordForm() {
  const t = useTranslations("forgotPassword");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  // One request at a time, however fast the button is pressed; it always ends, so the button always comes back.
  const action = useAction();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDevLink(null);
    setSent(false);
    const outcome = await action.run(
      (signal) =>
        requestJson<{ ok?: boolean; error?: string; devToken?: string }>(
          "/api/auth/forgot-password",
          { method: "POST", body: { email, locale }, signal },
        ),
      { write: true },
    );
    if (outcome.status === "dropped" || outcome.status === "cancelled") return;
    if (outcome.status === "failed") {
      const { failure } = outcome;
      // After a timeout or a dropped connection the email may well be on its
      // way: say that it is unconfirmed, not that it failed.
      setError(
        failure.outcomeUnknown
          ? t("unconfirmed")
          : failure.kind === "rate_limited"
            ? t("rateLimited")
            : t("errorGeneric"),
      );
      return;
    }
    const data = outcome.value;
    if (!data?.ok) {
      setError(t("errorGeneric"));
      return;
    }
    if (data.devToken) {
      const path =
        locale === "fr" ? "/fr/definir-mot-de-passe" : "/set-password";
      setDevLink(`${path}?token=${encodeURIComponent(data.devToken)}`);
    }
    setSent(true);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        {t("email")}
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange"
        />
      </label>
      <button
        type="submit"
        disabled={action.pending}
        aria-busy={action.pending}
        className="rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60"
      >
        <BusyLabel pending={action.pending} busyLabel={t("sending")}>
          {t("submit")}
        </BusyLabel>
      </button>
      {sent ? (
        <p className="text-sm text-navy/80" role="status">
          {t("sent")}
        </p>
      ) : null}
      {devLink ? (
        <p className="rounded-md border border-navy/10 bg-[var(--color-surface,#f7f5f1)] px-3 py-2 text-sm text-navy">
          {t("devLink")}{" "}
          <a className="font-semibold underline" href={devLink}>
            {t("devLinkCta")}
          </a>
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-navy/70">
        {t("lostEmail")}{" "}
        <Link href="/account-recovery" className="font-semibold underline">
          {t("lostEmailCta")}
        </Link>
      </p>
      <p className="text-sm text-navy/70">
        <Link href="/login" className="font-semibold underline">
          {t("back")}
        </Link>
      </p>
    </form>
  );
}
