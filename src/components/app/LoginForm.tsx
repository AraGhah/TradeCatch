"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const inputClass =
  "rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange";
const buttonClass =
  "rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60";

type Mode = "password" | "link";
type Status = "idle" | "loading" | "sent" | "error";

/** Messages for the codes the sign-in routes can send back to this page. */
export type LoginNotice = "linkInvalid" | "linkRateLimited" | "passwordSaved";

export function LoginForm({
  notice,
  returnTo,
}: {
  notice?: LoginNotice | null;
  /** The workspace page they were heading to (already validated on the server). */
  returnTo?: string | null;
}) {
  const t = useTranslations("login");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  // The sign-in service itself failed (not the person's details): keep what they typed and offer a way around it.
  const [outage, setOutage] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setStatus("idle");
    setError(null);
    setDevLink(null);
    setOutage(false);
    setPassword("");
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    setOutage(false);
    try {
      const res = await fetch("/api/auth/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          locale,
          ...(returnTo ? { next: returnTo } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
      };
      if (res.ok && data.ok && data.next) {
        // A full navigation, so the new session cookie is used for the first page.
        window.location.assign(data.next);
        return;
      }
      setStatus("error");
      // 503 means the sign-in service could not be reached, which says nothing
      // about the account; 403 is an account that cannot be used right now.
      const serviceDown = res.status >= 500;
      setOutage(serviceDown);
      setError(
        serviceDown
          ? t("errorOutage")
          : data.error === "invalid_credentials"
            ? t("errorInvalid")
            : data.error === "rate_limited"
              ? t("errorRateLimited")
              : data.error === "unavailable"
                ? t("errorUnavailable")
                : t("errorGeneric"),
      );
    } catch {
      setStatus("error");
      setOutage(true);
      setError(t("errorOutage"));
    }
  }

  async function onLinkSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
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
          ...(returnTo ? { next: returnTo } : {}),
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
        setDevLink(
          `/api/auth/callback?token=${encodeURIComponent(data.devToken)}&locale=${locale}`,
        );
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError(t("errorGeneric"));
    }
  }

  const noticeText =
    notice === "linkInvalid"
      ? t("linkInvalid")
      : notice === "linkRateLimited"
        ? t("linkRateLimited")
        : notice === "passwordSaved"
          ? t("passwordSaved")
          : null;

  return (
    <form
      onSubmit={mode === "password" ? onPasswordSubmit : onLinkSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4"
    >
      {noticeText ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            notice === "passwordSaved"
              ? "border-navy/10 bg-[var(--color-surface,#f7f5f1)] text-navy"
              : "border-red-700/30 bg-red-50 text-red-800"
          }`}
          role={notice === "passwordSaved" ? "status" : "alert"}
        >
          {noticeText}
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        {t("email")}
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      {mode === "password" ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
            {t("password")}
            <input
              type="password"
              required
              autoComplete="current-password"
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={status === "loading"}
            className={buttonClass}
          >
            {status === "loading" ? t("passwordSending") : t("passwordSubmit")}
          </button>
          <p className="text-sm text-navy/70">
            <Link href="/forgot-password" className="font-semibold underline">
              {t("forgot")}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-navy/70">{t("linkIntro")}</p>
          <button
            type="submit"
            disabled={status === "loading"}
            className={buttonClass}
          >
            {status === "loading" ? t("sending") : t("submit")}
          </button>
        </>
      )}
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
          {outage && mode === "password" ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => switchMode("link")}
                className="font-semibold underline"
              >
                {t("useLink")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => switchMode(mode === "password" ? "link" : "password")}
        className="self-start text-sm font-semibold text-navy underline"
      >
        {mode === "password" ? t("useLink") : t("usePassword")}
      </button>
      <p className="text-sm text-navy/60">
        <Link href="/book-audit" className="underline">
          {t("preferAudit")}
        </Link>
      </p>
    </form>
  );
}
