import type { ReactNode } from "react";
import { InlineStatus } from "./Spinner";

/**
 * Placeholders that hold the place and rough shape of what is loading, so the
 * page does not jump when the data arrives and no full-page spinner is needed.
 * They are decoration (`aria-hidden`); `LoadingRegion` is what tells a screen
 * reader that something is loading, and what.
 */

/** One grey block. Size it with `className` (`h-4 w-40`). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="skeleton"
      className={`block rounded bg-navy/10 motion-safe:animate-pulse ${className}`}
    />
  );
}

/** A paragraph's worth of lines; the last is shorter, as a real paragraph's is. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={`h-4 ${index === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** Dashboard tiles: a small label over a big figure. */
export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div
      aria-hidden="true"
      className="grid gap-3 sm:grid-cols-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-md border border-navy/10 bg-white px-4 py-3"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

/** List or table rows. On a phone the columns collapse into the one wide cell. */
export function SkeletonRows({
  rows = 5,
  columns = 3,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="divide-y divide-navy/10 rounded-md border border-navy/10 bg-white"
    >
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-3 py-3">
          <Skeleton className="h-4 flex-[2]" />
          {Array.from({ length: Math.max(0, columns - 1) }, (_, col) => (
            <Skeleton key={col} className="hidden h-4 flex-1 sm:block" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The calendar: a header bar, then a grid of day cells. */
export function SkeletonCalendar({ weeks = 5 }: { weeks?: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-md border border-navy/10 bg-white p-3"
    >
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: weeks * 7 }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps a skeleton with the words that say what is loading. The words are
 * visible (a spinner and "Loading appointments…") and announced politely; the
 * skeleton under them is only for the eyes. Give it the same `minHeight` as the
 * content it stands in for when that is known.
 */
export function LoadingRegion({
  label,
  children,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 ${className}`} data-loading="true">
      <InlineStatus>{label}</InlineStatus>
      {children}
    </div>
  );
}
