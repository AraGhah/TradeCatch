"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PasswordField } from "@/components/PasswordField";
import { BusyLabel } from "@/components/ui/Spinner";
import { requestJson } from "@/lib/client/request";
import { useAction } from "@/lib/client/use-action";

const PROBLEMS = ["too_short", "too_long", "common", "contains_email"] as const;
type Problem = (typeof PROBLEMS)[number];

function isProblem(value: unknown): value is Problem {
  return PROBLEMS.includes(value as Problem);
}

/**
 * Choose a password from an activation or reset link, then land signed in.
 * `onInvalid` runs when the server says the link has meanwhile expired or been
 * used (another tab, another device), so the page can show the expired-link
 * message and the way to ask for a new one.
 */
export function SetPasswordForm({
  token,
  onInvalid,
}: {
  token: string;
  onInvalid: () => void;
}) {
  const t = useTranslations("setPassword");
  const problems = useTranslations("passwordProblems");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Once the password is set the browser is on its way to the workspace: the
  // link is single-use, so the form must not be submitted a second time.
  const [redirecting, setRedirecting] = useState(false);
  const action = useAction();
  const saving = action.pending || redirecting;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    const outcome = await action.run(
      (signal) =>
        requestJson<{ ok?: boolean; next?: string; error?: string; problem?: string }>(
          "/api/auth/set-password",
          { method: "POST", body: { token, password, locale }, signal },
        ),
      { write: true },
    );
    if (outcome.status === "dropped" || outcome.status === "cancelled") return;
    if (outcome.status === "ok") {
      if (outcome.value?.ok && outcome.value.next) {
        setRedirecting(true);
        window.location.assign(outcome.value.next);
        return;
      }
      setError(t("errorGeneric"));
      return;
    }
    const { failure } = outcome;
    const body = failure.body as { error?: unknown; problem?: unknown } | undefined;
    if (failure.outcomeUnknown) {
      // The single-use link may already have been used: do not say "failed".
      setError(t("unconfirmed"));
    } else if (body?.error === "weak_password" && isProblem(body.problem)) {
      setError(problems(body.problem));
    } else if (body?.error === "invalid_link") {
      onInvalid();
    } else if (body?.error === "rate_limited" || failure.kind === "rate_limited") {
      setError(t("rateLimited"));
    } else {
      setError(t("errorGeneric"));
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4"
    >
      <PasswordField
        label={t("password")}
        required
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        value={password}
        onChange={setPassword}
        describedBy="password-rules"
      />
      <PasswordField
        label={t("confirm")}
        required
        autoComplete="new-password"
        maxLength={128}
        value={confirm}
        onChange={setConfirm}
      />
      <p id="password-rules" className="text-sm text-navy/70">
        {t("rules")}
      </p>
      <button
        type="submit"
        disabled={saving}
        aria-busy={saving}
        className="rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60"
      >
        <BusyLabel pending={saving} busyLabel={t("saving")}>
          {t("submit")}
        </BusyLabel>
      </button>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
