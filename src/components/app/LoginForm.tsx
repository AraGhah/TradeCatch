"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function LoginForm() {
  const t = useTranslations("login");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "sent" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);
    setDevLink(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          locale,
          ...(companyName.trim()
            ? { companyName: companyName.trim(), plan: "starter" }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        devToken?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setError(data.error || t("errorGeneric"));
        return;
      }
      if (data.devToken) {
        setDevLink(`/api/auth/callback?token=${encodeURIComponent(data.devToken)}&locale=${locale}`);
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError(t("errorGeneric"));
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4">
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
      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        {t("companyOptional")}
        <input
          type="text"
          autoComplete="organization"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder={t("companyPlaceholder")}
          className="rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange"
        />
        <span className="text-xs font-normal text-navy/60">{t("companyHelp")}</span>
      </label>
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60"
      >
        {status === "loading" ? t("sending") : t("submit")}
      </button>
      {status === "sent" ? (
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
      <p className="text-sm text-navy/60">
        <Link href="/book-audit" className="underline">
          {t("preferAudit")}
        </Link>
      </p>
    </form>
  );
}
