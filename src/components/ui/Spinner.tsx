import type { ReactNode } from "react";

/**
 * The one spinner. It takes its colour and size from the text around it
 * (`currentColor`, `1em`), so it suits a navy button, an orange button and a
 * line of grey text alike. It is decoration: the words next to it carry the
 * meaning, so screen readers skip it. With "reduce motion" on it stands still
 * as a ring with a gap and the words say what is happening.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="spinner"
      className={`inline-block h-[1em] w-[1em] shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin ${className}`}
    />
  );
}

/**
 * A button's label: `children` when idle, spinner plus `busyLabel` while it
 * works ("Saving…", "Signing in…"). Pair it with `disabled={pending}` and
 * `aria-busy={pending}` on the button.
 */
export function BusyLabel({
  pending,
  busyLabel,
  children,
}: {
  pending: boolean;
  busyLabel: ReactNode;
  children: ReactNode;
}) {
  if (!pending) return <>{children}</>;
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner />
      {busyLabel}
    </span>
  );
}

/** A line of text with a spinner: "Loading appointments…". Announced politely. */
export function InlineStatus({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`m-0 flex items-center gap-2 text-sm text-navy/70 ${className}`}
    >
      <Spinner />
      <span>{children}</span>
    </p>
  );
}
