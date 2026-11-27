"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Failure } from "@/lib/client/use-action";
import { Spinner } from "./Spinner";

/**
 * What an action says when it is done or has failed. One look, one set of
 * announcements:
 *
 *  - success is `role="status"` (polite) and is shown only after the server
 *    confirmed the change;
 *  - an error is `role="alert"` (assertive), says what happened in words the
 *    person can act on, and offers "Try again" only when that is safe;
 *  - a symbol and the words carry the meaning; colour only reinforces it.
 */

export type FeedbackTone = "success" | "error" | "info";

const TONE: Record<FeedbackTone, string> = {
  success: "border-green-300 bg-green-50 text-green-900",
  error: "border-red-300 bg-red-50 text-red-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
};
const MARK: Record<FeedbackTone, string> = {
  success: "✓",
  error: "!",
  info: "i",
};

export function FeedbackMessage({
  tone,
  children,
  onRetry,
  retrying = false,
  className = "",
  testId,
}: {
  tone: FeedbackTone;
  children: ReactNode;
  /** Shows a "Try again" button. Pass only when repeating the action is safe. */
  onRetry?: () => void;
  /** The retry is running: the button is disabled and says so. */
  retrying?: boolean;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("feedback");
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      data-tone={tone}
      className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm ${TONE[tone]} ${className}`}
    >
      <span
        aria-hidden="true"
        className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
      >
        {MARK[tone]}
      </span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-current px-3 py-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? <Spinner /> : null}
          {retrying ? t("retrying") : t("retry")}
        </button>
      ) : null}
    </div>
  );
}

/** The words for a `Failure`, in the viewer's language. */
export function useFailureText() {
  const t = useTranslations("feedback.errors");
  return (failure: Failure): string => {
    switch (failure.kind) {
      case "timeout":
        return failure.outcomeUnknown ? t("timeoutUnknown") : t("timeout");
      case "network":
        return failure.outcomeUnknown ? t("networkUnknown") : t("network");
      case "rate_limited":
        return t("rateLimited", {
          seconds: Math.max(1, Math.ceil((failure.retryAfterMs ?? 5_000) / 1_000)),
        });
      case "blocked":
        return t("blocked");
      case "unavailable":
        return t("unavailable");
      case "server":
        return failure.outcomeUnknown ? t("serverUnknown") : t("server");
      case "unauthorized":
        return t("unauthorized");
      case "forbidden":
        return t("forbidden");
      case "invalid":
        return t("invalid");
      case "conflict":
        return t("conflict");
      default:
        return t("unknown");
    }
  };
}

/**
 * A failure as a message, with "Try again" when it is safe. `specific` lets a
 * screen replace the generic words for one kind (a 409 on its own form says
 * what changed) while keeping the rest.
 */
export function FailureMessage({
  failure,
  onRetry,
  retrying,
  specific,
  className,
  testId = "failure-message",
}: {
  failure: Failure;
  onRetry?: () => void;
  retrying?: boolean;
  specific?: Partial<Record<Failure["kind"], string>>;
  className?: string;
  testId?: string;
}) {
  const text = useFailureText();
  return (
    <FeedbackMessage
      tone="error"
      testId={testId}
      className={className}
      onRetry={failure.retrySafe ? onRetry : undefined}
      retrying={retrying}
    >
      {specific?.[failure.kind] ?? text(failure)}
    </FeedbackMessage>
  );
}
