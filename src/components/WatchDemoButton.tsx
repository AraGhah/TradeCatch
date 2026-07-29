"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";

const VIDEO_SRC = {
  en: "/demo-video/TradeCatch-Demo-EN.mp4",
  fr: "/demo-video/TradeCatch-Demo-FR.mp4",
} as const;

const CAPTION_SRC = {
  en: "/demo-video/captions/en.vtt",
  fr: "/demo-video/captions/fr.vtt",
} as const;

type LocaleKey = keyof typeof VIDEO_SRC;

function resolveLocale(raw: string): LocaleKey {
  return raw.startsWith("fr") ? "fr" : "en";
}

/**
 * Opens the locale-matched TradeCatch demo MP4 in an accessible dialog.
 * Used by the homepage “See the live demo” CTAs.
 */
export function WatchDemoButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const locale = resolveLocale(useLocale());
  const t = useTranslations("demoVideo");
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const transcriptId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const close = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setOpen(false);
  }, []);

  const openModal = useCallback(() => {
    trackEvent("demo_video_open", { locale });
    setOpen(true);
  }, [locale]);

  useEffect(() => {
    if (!open) {
      openerRef.current?.focus();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), video, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);

    const video = videoRef.current;
    if (video) {
      void video.play().catch(() => undefined);
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={openModal}
        className={className}
      >
        {children}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-8"
          role="presentation"
        >
          <button
            type="button"
            aria-label={t("close")}
            className="absolute inset-0 bg-navy/80 backdrop-blur-[2px]"
            onClick={close}
          />

          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={transcriptId}
            className="relative z-[1] w-full max-w-[1100px] overflow-hidden rounded-[14px] border border-white/12 bg-[#0a1018] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.75)]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
              <h2
                id={titleId}
                className="truncate text-[15px] font-semibold tracking-[-0.01em] text-white"
              >
                {t("playerTitle")}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[13px] font-semibold text-white/90 transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
              >
                {t("close")}
              </button>
            </div>

            <div className="bg-black aspect-video">
              <video
                ref={videoRef}
                key={locale}
                className="h-full w-full"
                controls
                playsInline
                preload="metadata"
                src={VIDEO_SRC[locale]}
              >
                <track
                  kind="captions"
                  srcLang={locale}
                  label={t("captionsLabel")}
                  src={CAPTION_SRC[locale]}
                  default
                />
              </video>
            </div>

            <details className="border-t border-white/10 px-4 py-3 sm:px-5">
              <summary className="cursor-pointer text-[13px] font-semibold text-white/85">
                {t("transcriptTitle")}
              </summary>
              <p
                id={transcriptId}
                className="mt-2 max-h-40 overflow-y-auto text-[13px] leading-relaxed text-white/70"
              >
                {t("transcript")}
              </p>
            </details>
          </div>
        </div>
      ) : null}
    </>
  );
}
