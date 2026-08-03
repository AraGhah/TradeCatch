"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "tc-theme";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Storage may be unavailable (private browsing quota) — theme just won't persist.
  }
}

/**
 * Manual light/dark toggle, independent of the OS color-scheme preference.
 * The initial class is set synchronously by the inline script in
 * HeadInlineScripts (before hydration) so this only needs to read it back
 * for the icon state, never write on mount.
 */
export function ThemeToggle({
  className = "",
  inverted = false,
  labelToDark,
  labelToLight,
}: {
  className?: string;
  inverted?: boolean;
  labelToDark: string;
  labelToLight: string;
}) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    setDark((prev) => {
      const next = !prev;
      applyTheme(next);
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? labelToLight : labelToDark}
      aria-pressed={dark}
      className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border transition-colors ${
        inverted
          ? "border-white/20 text-white/85 hover:border-white/40"
          : "border-[rgb(var(--ink-rgb)/0.16)] text-heading hover:border-navy"
      } ${className}`}
    >
      {dark ? (
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="h-[17px] w-[17px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="10" cy="10" r="4.2" />
          <path
            strokeLinecap="round"
            d="M10 1.6v2M10 16.4v2M18.4 10h-2M3.6 10h-2M15.66 4.34l-1.42 1.42M5.76 14.24l-1.42 1.42M15.66 15.66l-1.42-1.42M5.76 5.76 4.34 4.34"
          />
        </svg>
      ) : (
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="h-[16px] w-[16px]"
          fill="currentColor"
        >
          <path d="M17.3 12.4A7.5 7.5 0 0 1 7.6 2.7a.6.6 0 0 0-.75-.78A8.7 8.7 0 1 0 18.08 13.15a.6.6 0 0 0-.78-.75Z" />
        </svg>
      )}
    </button>
  );
}
