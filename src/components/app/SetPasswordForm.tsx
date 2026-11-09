"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

const inputClass =
  "rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange";

const PROBLEMS = ["too_short", "too_long", "common", "contains_email"] as const;
type Problem = (typeof PROBLEMS)[number];

function isProblem(value: unknown): value is Problem {
  return PROBLEMS.includes(value as Problem);
}

/** Choose a password from an activation or reset link, then land signed in. */
export function SetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("setPassword");
  const problems = useTranslations("passwordProblems");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
        problem?: string;
      };
      if (res.ok && data.ok && data.next) {
        window.location.assign(data.next);
        return;
      }
      setSaving(false);
      if (data.error === "weak_password" && isProblem(data.problem)) {
        setError(problems(data.problem));
      } else if (data.error === "invalid_link") {
        setError(t("invalidLink"));
      } else if (data.error === "rate_limited") {
        setError(t("rateLimited"));
      } else {
        setError(t("errorGeneric"));
      }
    } catch {
      setSaving(false);
      setError(t("errorGeneric"));
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        {t("password")}
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-rules"
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
      <p id="password-rules" className="text-sm text-navy/70">
        {t("rules")}
      </p>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60"
      >
        {saving ? t("saving") : t("submit")}
      </button>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
