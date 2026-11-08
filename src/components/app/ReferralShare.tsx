"use client";

import { useEffect, useRef, useState } from "react";

type Labels = {
  linkLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;
  /** Shown and announced after a successful copy, e.g. "Link copied to your clipboard." */
  copiedStatus: string;
  share: string;
  email: string;
  sms: string;
  otherLanguage: string;
  /** The finished message, link included. */
  shareMessage: string;
  emailSubject: string;
};

const BUTTON =
  "rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-navy/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2";

/** Last resort for browsers or frames that refuse the async clipboard API. */
function copyWithSelection(input: HTMLInputElement | null): boolean {
  if (!input) return false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

export function ReferralShare({
  link,
  otherLink,
  labels,
}: {
  link: string;
  otherLink: string;
  labels: Labels;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  const message = labels.shareMessage;

  // Decided after mount so the server and first client render agree.
  useEffect(() => {
    setCanShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  // "Copied" is a confirmation, not a permanent state.
  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus("copied");
      return;
    } catch {
      // Blocked or unavailable: try the selection route before giving up.
    }
    if (copyWithSelection(inputRef.current)) {
      setStatus("copied");
      return;
    }
    // Nothing worked: leave the link selected so Ctrl/Cmd+C does.
    inputRef.current?.select();
    setStatus("failed");
  }

  async function share() {
    try {
      await navigator.share({
        title: labels.emailSubject,
        text: message,
        url: link,
      });
    } catch {
      // Dismissed by the person: nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        className="flex flex-col gap-1 text-sm font-medium text-navy"
        htmlFor="referral-link"
      >
        {labels.linkLabel}
        <input
          id="referral-link"
          ref={inputRef}
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-md border border-navy/20 bg-paper px-3 py-2 font-mono text-sm text-navy"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className={BUTTON}
          data-testid="referral-copy"
        >
          {status === "copied" ? `✓ ${labels.copied}` : labels.copy}
        </button>
        {canShare ? (
          <button type="button" onClick={share} className={BUTTON}>
            {labels.share}
          </button>
        ) : null}
        <a
          className={BUTTON}
          href={`mailto:?subject=${encodeURIComponent(labels.emailSubject)}&body=${encodeURIComponent(message)}`}
        >
          {labels.email}
        </a>
        <a className={BUTTON} href={`sms:?&body=${encodeURIComponent(message)}`}>
          {labels.sms}
        </a>
      </div>
      <p
        className={`min-h-[1.25rem] text-sm ${
          status === "failed" ? "text-red-700" : "text-signal-text"
        }`}
        role="status"
        aria-live="polite"
        data-testid="referral-copy-status"
      >
        {status === "copied"
          ? labels.copiedStatus
          : status === "failed"
            ? labels.copyFailed
            : ""}
      </p>
      <p className="text-xs text-navy/60">
        <a className="underline" href={otherLink}>
          {labels.otherLanguage}
        </a>
      </p>
    </div>
  );
}
