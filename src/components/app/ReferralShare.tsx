"use client";

import { useRef, useState } from "react";

type Labels = {
  linkLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;
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
  const message = labels.shareMessage;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus("copied");
    } catch {
      // Clipboard blocked: select the text so Ctrl/Cmd+C works.
      inputRef.current?.select();
      setStatus("failed");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: labels.emailSubject, text: message, url: link });
    } catch {
      // Dismissed by the person: nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-navy" htmlFor="referral-link">
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
        <button type="button" onClick={copy} className={BUTTON}>
          {status === "copied" ? labels.copied : labels.copy}
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
      <p className="text-sm text-navy/70" role="status" aria-live="polite">
        {status === "failed" ? labels.copyFailed : " "}
      </p>
      <p className="text-xs text-navy/60">
        <a className="underline" href={otherLink}>
          {labels.otherLanguage}
        </a>
      </p>
    </div>
  );
}
