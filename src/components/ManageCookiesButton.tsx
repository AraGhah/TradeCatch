"use client";

import { MANAGE_COOKIES_EVENT } from "@/lib/analytics";

export function ManageCookiesButton({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(MANAGE_COOKIES_EVENT))}
      className={`${className} text-left`}
    >
      {label}
    </button>
  );
}
