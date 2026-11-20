"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * A labelled password input with a show/hide button inside its right edge.
 *
 * - Hidden by default; the choice lives only in this component's state, so it is
 *   never stored, never sent anywhere and resets on every reload.
 * - Each field keeps its own state, so showing one password never reveals another.
 * - The button is `type="button"` so it can never submit the form, and it is a real
 *   button so Tab, Enter and Space work without extra code.
 * - Switching the input between `password` and `text` keeps the same element, so the
 *   typed value is untouched and the caret/selection is restored if the field had focus.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  maxLength,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Id of an element that explains the field (for example the password rules). */
  describedBy?: string;
}) {
  const t = useTranslations("passwordToggle");
  const id = useId();
  const labelId = `${id}-label`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  // Where the caret was when the field was toggled with the pointer, to put it back.
  const caret = useRef<{
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const saved = caret.current;
    caret.current = null;
    if (input && saved) {
      input.setSelectionRange(saved.start, saved.end, saved.direction);
    }
  }, [visible]);

  // A page restored from the back/forward cache is a frozen copy of what was on screen.
  // Hide the password before the page is stored so it does not come back readable.
  useEffect(() => {
    if (!visible) return;
    const hide = () => {
      if (inputRef.current) inputRef.current.type = "password";
      setVisible(false);
    };
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [visible]);

  function toggle() {
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      caret.current = {
        start: input.selectionStart ?? input.value.length,
        end: input.selectionEnd ?? input.value.length,
        direction: input.selectionDirection ?? "none",
      };
    }
    setVisible((current) => !current);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        id={labelId}
        htmlFor={id}
        className="text-sm font-medium text-navy"
      >
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          // A visible password is plain text to the browser: keep it out of spell-check
          // services and stop phone keyboards from capitalising or "correcting" it.
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          // Edge draws its own reveal button on password inputs; ours replaces it.
          className="w-full rounded-md border border-navy/15 bg-white py-2.5 pl-3 pr-12 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange [&::-ms-reveal]:hidden"
        />
        <button
          type="button"
          onClick={toggle}
          // Keep focus (and the on-screen keyboard) in the input when the pointer is used;
          // keyboard users reach the button with Tab and it takes focus as usual.
          onMouseDown={(e) => e.preventDefault()}
          aria-label={visible ? t("hide") : t("show")}
          aria-controls={id}
          aria-describedby={labelId}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-navy/70 transition hover:text-navy focus-visible:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M1.5 12C4 7.5 7.7 5.5 12 5.5s8 2 10.5 6.5c-2.5 4.5-6.2 6.5-10.5 6.5S4 16.5 1.5 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>
      </div>
    </div>
  );
}
