"use client";

import { useLinkStatus } from "next/link";

/**
 * Fixed-size hint inside a `<Link>`. Invisible on fast (prefetched) navigations;
 * appears only after a short delay when the transition actually takes time.
 * Decorative — the destination page's `loading.tsx` / status message carries
 * the accessible announcement. Respects `prefers-reduced-motion`.
 */
export function LinkPendingHint({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-testid="link-pending-hint"
      data-pending={pending ? "true" : "false"}
      className={`tc-link-hint ${pending ? "tc-link-hint--pending" : ""} ${className}`}
    />
  );
}
