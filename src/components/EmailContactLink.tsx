"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

/** A browser fallback remains usable even without JavaScript or a mail handler. */
export function EmailContactLink({
  email,
  children,
  className,
}: {
  email: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("emailContact");
  const dialog = useRef<HTMLDialogElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const addressId = useId();
  const [status, setStatus] = useState("");
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
  const actionClass =
    "rounded-md border border-current px-4 py-3 text-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-4";

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(email);
      setStatus(t("copied"));
    } catch {
      // Denied/missing clipboard access must not leave a dead-end button.
      address.current?.focus();
      address.current?.select();
      setStatus(t("copyFallback"));
    }
  }

  return (
    <>
      <a
        href={gmail}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
          if (!dialog.current?.showModal) return;
          event.preventDefault();
          setStatus("");
          dialog.current.showModal();
        }}
      >
        {children}
      </a>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-gray-300 bg-paper p-6 text-heading shadow-xl backdrop:bg-black/60"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {t("title")}
        </h2>
        <p className="mt-3 text-sm">{t("description")}</p>
        <label htmlFor={addressId} className="mt-4 block text-sm font-semibold">
          {t("address")}
        </label>
        <input
          ref={address}
          id={addressId}
          value={email}
          readOnly
          className="mt-1 w-full rounded border border-gray-400 bg-paper p-2 text-heading"
        />
        <div className="mt-5 flex flex-col gap-3">
          <a
            href={gmail}
            target="_blank"
            rel="noopener noreferrer"
            className={actionClass}
          >
            {t("gmail")}
          </a>
          <a
            href={`mailto:${encodeURIComponent(email)}`}
            className={actionClass}
          >
            {t("emailApp")}
          </a>
          <button type="button" onClick={copyAddress} className={actionClass}>
            {t("copy")}
          </button>
        </div>
        <p role="status" className="mt-3 text-sm">
          {status}
        </p>
        <form method="dialog" className="mt-4 text-right">
          <button className={actionClass}>{t("close")}</button>
        </form>
      </dialog>
    </>
  );
}
