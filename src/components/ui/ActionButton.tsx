"use client";

import {
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { BusyLabel } from "./Spinner";

/**
 * A button that shows honest progress: idle label, spinner + busy words while
 * the request runs, optional success wording only after a confirmed result.
 * Dimensions stay put (`min-h` + inline-flex) so the layout does not jump when
 * the label changes. Pair with `useGuarded` / `useAction` / `useSingleFlight`
 * so a second click never starts a second request.
 */
export type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-busy"
> & {
  /** True while the request is in flight. */
  pending?: boolean;
  /** Words shown with the spinner ("Saving…", "Sending…"). */
  busyLabel: ReactNode;
  /**
   * True only after the server confirmed success. Cleared by the caller when
   * the person edits again or navigates away.
   */
  success?: boolean;
  /** Confirmation wording ("Saved", "Sent"). Shown instead of children. */
  successLabel?: ReactNode;
};

export function ActionButton({
  pending = false,
  busyLabel,
  success = false,
  successLabel,
  disabled,
  className = "",
  children,
  type = "button",
  ...props
}: ActionButtonProps) {
  const busy = pending;
  const showSuccess = success && !busy && successLabel != null;
  return (
    <button
      type={type}
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {showSuccess ? (
        <span data-testid="action-success">{successLabel}</span>
      ) : (
        <BusyLabel pending={busy} busyLabel={busyLabel}>
          {children}
        </BusyLabel>
      )}
    </button>
  );
}
