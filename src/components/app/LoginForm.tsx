"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PasswordField } from "@/components/PasswordField";
import { BusyLabel } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { requestJson } from "@/lib/client/request";
import { useAction, type Failure } from "@/lib/client/use-action";

const inputClass =
  "h-12 rounded-[var(--radius-md)] border border-navy/15 bg-white px-3 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange aria-[invalid=true]:border-red-700";
const buttonClass =
  "min-h-12 rounded-[var(--radius-md)] bg-orange px-4 py-3 text-[15.5px] font-bold text-navy transition-colors hover:bg-orange-dark disabled:opacity-60";
const fieldErrorClass = "m-0 -mt-2 text-sm text-red-700";
/** Loose on purpose: the server is the judge; this only catches obvious slips. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "password" | "link";

/** Messages for the codes the sign-in routes can send back to this page. */
export type LoginNotice = "linkInvalid" | "linkRateLimited" | "passwordSaved";

type SignInAnswer = { ok?: boolean; next?: string; error?: string; devToken?: string };

/** The `error` code the sign-in route put in its JSON answer, if any. */
function codeOf(failure: Failure): string | undefined {
  const code = (failure.body as { error?: unknown } | undefined)?.error;
  return typeof code === "string" ? code : undefined;
}

/**
 * The sign-in service itself failed (it did not answer, or answered with an
 * error of its own), which says nothing about the person's details.
 */
function serviceFailed(failure: Failure): boolean {
  return (
    failure.kind === "timeout" ||
    failure.kind === "network" ||
    failure.kind === "unavailable" ||
    failure.kind === "server"
  );
}

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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  // The sign-in service itself failed (not the person's details): keep what they typed and offer a way around it.
  const [outage, setOutage] = useState(false);
  // True once the browser is on its way to the workspace: signing in again from here would be a second sign-in.
  const [redirecting, setRedirecting] = useState(false);
  // Where the server said to go, so a navigation that stalls can be retried without signing in again.
  const [destination, setDestination] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: boolean; password?: boolean }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const emailErrorId = `${fieldId}-email-error`;
  const passwordErrorId = `${fieldId}-password-error`;
  // One sign-in request at a time, however fast the button is pressed; it always ends (30 s), so the button always comes back.
  const action = useAction();
  const busy = action.pending || redirecting;

  function switchMode(next: Mode) {
    setMode(next);
    setSent(false);
    setError(null);
    setDevLink(null);
    setOutage(false);
    setPassword("");
    setFieldErrors({});
  }

  /** Marks what is missing and moves focus to the first of them. Sends nothing. */
  function validate(needsPassword: boolean): boolean {
    const invalid = {
      email: !EMAIL_SHAPE.test(email.trim()),
      password: needsPassword && !password,
    };
    setFieldErrors(invalid);
    if (invalid.email) emailRef.current?.focus();
    else if (invalid.password) passwordRef.current?.focus();
    return !invalid.email && !invalid.password;
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setOutage(false);
    if (!validate(true)) return;
    const outcome = await action.run(
      (signal) =>
        requestJson<SignInAnswer>("/api/auth/password-login", {
          method: "POST",
          body: {
            email,
            password,
            locale,
            ...(returnTo ? { next: returnTo } : {}),
          },
          signal,
        }),
      { write: true },
    );
    if (outcome.status === "dropped" || outcome.status === "cancelled") return;
    if (outcome.status === "ok") {
      if (outcome.value?.ok && outcome.value.next) {
        // A full navigation, so the new session cookie is used for the first page.
        setRedirecting(true);
        setDestination(outcome.value.next);
        window.location.assign(outcome.value.next);
        return;
      }
      setError(t("errorGeneric"));
      return;
    }
    const failure = outcome.failure;
    const code = codeOf(failure);
    // 5xx and no answer mean the sign-in service could not be reached, which
    // says nothing about the account; a refused account cannot be used right now.
    const down = serviceFailed(failure);
    setOutage(down);
    setError(
      down
        ? t("errorOutage")
        : code === "invalid_credentials"
          ? t("errorInvalid")
          : code === "rate_limited" || failure.kind === "rate_limited"
            ? t("errorRateLimited")
            : code === "unavailable"
              ? t("errorUnavailable")
              : t("errorGeneric"),
    );
  }

  async function onLinkSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setDevLink(null);
    setSent(false);
    if (!validate(false)) return;
    const outcome = await action.run(
      (signal) =>
        requestJson<SignInAnswer>("/api/auth/magic-link", {
          method: "POST",
          body: {
            email,
            locale,
            ...(returnTo ? { next: returnTo } : {}),
          },
          signal,
        }),
      { write: true },
    );
    if (outcome.status === "dropped" || outcome.status === "cancelled") return;
    if (outcome.status === "failed") {
      const failure = outcome.failure;
      // Whether the email went out is not known after a timeout or a dropped
      // connection: say so instead of "failed".
      setError(
        failure.outcomeUnknown
          ? t("linkUnconfirmed")
          : failure.kind === "rate_limited"
            ? t("linkRateLimited")
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
      // The same address the emailed link has, return path included.
      setDevLink(
        `/api/auth/callback?token=${encodeURIComponent(data.devToken)}&locale=${locale}${returnTo ? `&next=${encodeURIComponent(returnTo)}` : ""}`,
      );
    }
    setSent(true);
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
      // Never a GET: a submit before the page is ready must not put a password in the address.
      method="post"
      noValidate
      aria-busy={busy}
      className="flex w-full flex-col gap-4"
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
          ref={emailRef}
          type="email"
          name="email"
          inputMode="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((current) => ({ ...current, email: false }));
          }}
          aria-invalid={fieldErrors.email || undefined}
          aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          className={inputClass}
        />
      </label>
      {fieldErrors.email ? (
        <p id={emailErrorId} className={fieldErrorClass}>
          {t("invalidEmail")}
        </p>
      ) : null}
      {mode === "password" ? (
        <>
          <PasswordField
            label={t("password")}
            required
            autoComplete="current-password"
            maxLength={256}
            name="password"
            inputRef={passwordRef}
            inputClassName="h-12"
            invalid={fieldErrors.password}
            describedBy={fieldErrors.password ? passwordErrorId : undefined}
            value={password}
            onChange={(value) => {
              setPassword(value);
              setFieldErrors((current) => ({ ...current, password: false }));
            }}
          />
          {fieldErrors.password ? (
            <p id={passwordErrorId} className={fieldErrorClass}>
              {t("missingPassword")}
            </p>
          ) : null}
          <p className="m-0 -mt-1.5 text-right text-sm">
            <Link
              href="/forgot-password"
              className="font-semibold text-ember-text underline-offset-4 hover:underline"
            >
              {t("forgot")}
            </Link>
          </p>
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className={buttonClass}
          >
            <BusyLabel pending={busy} busyLabel={t("passwordSending")}>
              {t("passwordSubmit")}
            </BusyLabel>
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-navy/70">{t("linkIntro")}</p>
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className={buttonClass}
          >
            <BusyLabel pending={busy} busyLabel={t("sending")}>
              {t("submit")}
            </BusyLabel>
          </button>
        </>
      )}
      {destination ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.14)] bg-paper px-3.5 py-3 text-sm text-navy"
        >
          <p className="m-0 font-semibold">{t("opening")}</p>
          <p className="m-0 mt-1">
            {t("openingStuck")}{" "}
            <a className="font-semibold underline" href={destination}>
              {t("openingContinue")}
            </a>
          </p>
        </div>
      ) : null}
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
        <p
          className="m-0 rounded-[var(--radius-md)] border border-red-700/25 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
          {outage && mode === "password" ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => switchMode("link")}
                disabled={busy}
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
        disabled={busy}
        className="min-h-12 rounded-[var(--radius-md)] border-[1.5px] border-[rgb(var(--ink-rgb)/0.18)] bg-surface px-4 py-2.5 text-[14.5px] font-semibold text-navy transition-colors hover:border-navy disabled:opacity-60"
      >
        {mode === "password" ? t("useLink") : t("usePassword")}
      </button>
      <p className="m-0 text-center text-sm text-muted">
        <Link href="/book-audit" className="underline">
          {t("preferAudit")}
        </Link>
      </p>
    </form>
  );
}
