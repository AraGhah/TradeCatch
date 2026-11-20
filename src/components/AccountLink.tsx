import type { AccountNav } from "@/components/useAccountNav";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/**
 * The header's profile icon. One real link whose destination depends on who is
 * signed in (see useAccountNav); the same size and border as the menu button
 * beside it so the two read as a set on a phone.
 */
export function AccountLink({ account }: { account: AccountNav }) {
  return (
    <a
      href={account.href}
      aria-label={account.label}
      title={account.label}
      aria-busy={account.busy || undefined}
      data-account-state={account.state}
      onClick={account.onActivate}
      className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] border border-[rgb(var(--ink-rgb)/0.14)] text-heading transition-colors hover:border-navy hover:bg-[rgb(var(--ink-rgb)/0.04)] ${
        account.busy ? "cursor-progress opacity-60" : ""
      } ${FOCUS_RING}`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20.5c0-4.14 3.36-6.5 7.5-6.5s7.5 2.36 7.5 6.5" />
      </svg>
    </a>
  );
}
