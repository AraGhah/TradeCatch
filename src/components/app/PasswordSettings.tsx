"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

const inputClass =
  "rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange";
const buttonClass =
  "self-start rounded-md bg-orange px-4 py-2.5 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60";

const PROBLEMS = ["too_short", "too_long", "common", "contains_email"] as const;
type Problem = (typeof PROBLEMS)[number];

function isProblem(value: unknown): value is Problem {
  return PROBLEMS.includes(value as Problem);
}

/**
 * Change the password, or, for someone who has only used email links so far,
 * ask for a link to choose one. Choosing a first password always goes through
 * the inbox so a stolen session cannot set one.
 */
export function PasswordSettings({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const t = useTranslations("app.passwordSettings");
  const problems = useTranslations("passwordProblems");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  async function onChange(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (next !== confirm) {
      setMessage({ text: t("mismatch"), ok: false });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        problem?: string;
      };
      if (res.ok && data.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
        setMessage({ text: t("saved"), ok: true });
      } else if (data.error === "weak_password" && isProblem(data.problem)) {
        setMessage({ text: problems(data.problem), ok: false });
      } else if (data.error === "wrong_password") {
        setMessage({ text: t("wrong"), ok: false });
      } else if (data.error === "same_password") {
        setMessage({ text: t("same"), ok: false });
      } else if (data.error === "rate_limited") {
        setMessage({ text: t("rateLimited"), ok: false });
      } else {
        setMessage({ text: t("generic"), ok: false });
      }
    } catch {
      setMessage({ text: t("generic"), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function onSendLink() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      setMessage(
        res.ok
          ? { text: t("linkSent"), ok: true }
          : { text: t("generic"), ok: false },
      );
    } catch {
      setMessage({ text: t("generic"), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="password-settings-heading"
      className="flex max-w-md flex-col gap-3"
    >
      <h2
        id="password-settings-heading"
        className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50"
      >
        {t("headline")}
      </h2>
      {hasPassword ? (
        <form onSubmit={onChange} className="flex flex-col gap-3">
          <p className="text-sm text-navy/70">{t("intro")}</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
            {t("current")}
            <input
              type="password"
              required
              autoComplete="current-password"
              maxLength={256}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
            {t("new")}
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
            {t("confirm")}
            <input
              type="password"
              required
              autoComplete="new-password"
              maxLength={128}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </label>
          <p className="text-sm text-navy/70">{t("rules")}</p>
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? t("saving") : t("submit")}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-navy">{t("noneTitle")}</p>
          <p className="text-sm text-navy/70">{t("noneBody")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSendLink()}
            className={buttonClass}
          >
            {busy ? t("linkSending") : t("sendLink")}
          </button>
        </div>
      )}
      {message ? (
        <p
          className={`text-sm ${message.ok ? "text-navy" : "text-red-700"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
