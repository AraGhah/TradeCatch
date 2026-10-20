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

// Icon swap: the outgoing icon shrinks, blurs and fades while the incoming one
// does the reverse, so the change reads as one object morphing.
const ICON_IN = "scale-100 opacity-100 blur-none";
const ICON_OUT = "scale-[0.25] opacity-0 blur-[4px]";
const iconBase = (animated: boolean) =>
  `absolute inset-0 m-auto ${
    animated
      ? "transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
      : ""
  }`;

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
  // The first sync with the page's saved theme must not animate: a visitor who
  // loads in dark mode should see the sun, not watch the moon swap out.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
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
      className={`relative flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border transition-colors after:absolute after:-inset-[3px] after:rounded-full after:content-[''] ${
        inverted
          ? "border-white/20 text-white/85 hover:border-white/40"
          : "border-[rgb(var(--ink-rgb)/0.16)] text-heading hover:border-navy"
      } ${className}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`${iconBase(settled)} h-[17px] w-[17px] ${dark ? ICON_IN : ICON_OUT}`}
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
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`${iconBase(settled)} h-[16px] w-[16px] ${dark ? ICON_OUT : ICON_IN}`}
        fill="currentColor"
      >
        <path d="M17.3 12.4A7.5 7.5 0 0 1 7.6 2.7a.6.6 0 0 0-.75-.78A8.7 8.7 0 1 0 18.08 13.15a.6.6 0 0 0-.78-.75Z" />
      </svg>
    </button>
  );
}
