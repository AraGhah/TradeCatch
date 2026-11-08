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
import { Link } from "@/i18n/navigation";
import { trackEvent } from "@/lib/analytics";
import type { DemoLocale } from "@/components/demo-video/cuts";
import {
  DEFAULT_STORY_ID,
  STORY_COPY_KEY,
  STORY_MEDIA,
  type StoryId,
} from "@/components/demo-video/stories";

function resolveLocale(raw: string): DemoLocale {
  return raw.startsWith("fr") ? "fr" : "en";
}

/**
 * Opens the one public TradeCatch demo ("Under the sink", see stories.ts) in
 * an accessible dialog, in the visitor's language. Captions are a separate
 * track; nothing is burned into the picture. There is no other public demo:
 * the interactive /demo-video experience and the other cuts are retired.
 */
export function WatchDemoButton({
  children,
  className,
  video = DEFAULT_STORY_ID,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  video?: StoryId;
  /** Needed when the button is a card whose visible text is long. */
  ariaLabel?: string;
}) {
  const locale = resolveLocale(useLocale());
  const media = STORY_MEDIA[video];
  const poster = media.poster;
  const copyKey = STORY_COPY_KEY[video];
  const t = useTranslations("demoVideo");
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const transcriptId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wasOpenRef = useRef(false);

  const close = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setOpen(false);
  }, []);

  const openModal = useCallback(() => {
    trackEvent("demo_video_open", { locale, video });
    setOpen(true);
  }, [locale, video]);

  useEffect(() => {
    // Only restore focus when the modal closes after having been open —
    // never steal focus on initial mount.
    if (!open && wasOpenRef.current) {
      openerRef.current?.focus();
    }
    wasOpenRef.current = open;
    if (!open) return;

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
        aria-label={ariaLabel}
        aria-haspopup="dialog"
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
            className="relative z-[1] max-h-[calc(100dvh-2rem)] w-full max-w-[620px] overflow-y-auto rounded-[14px] border border-white/12 bg-[#0a1018] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.75)] lg:max-w-[900px]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
              <h2
                id={titleId}
                className="truncate text-[15px] font-semibold tracking-[-0.01em] text-white"
              >
                {t(`${copyKey}.playerTitle`)}
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

            {/* Portrait (4:5): stacked on phones, video beside the text from lg up.
                The video is never taller than a fixed share of the viewport so its controls stay on screen. */}
            <div className="lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
              <div className="mx-auto aspect-[4/5] w-[min(100%,calc(62dvh*0.8))] bg-black lg:mx-0 lg:w-[calc(min(74dvh,720px)*0.8)]">
                <video
                  ref={videoRef}
                  key={`${video}-${locale}`}
                  className="h-full w-full"
                  controls
                  playsInline
                  preload="metadata"
                  poster={poster}
                  src={media.video[locale]}
                  onPlay={() =>
                    trackEvent("demo_video_started", { locale, video })
                  }
                  onEnded={() =>
                    trackEvent("demo_video_completed", { locale, video })
                  }
                >
                  <track
                    kind="captions"
                    srcLang={locale}
                    label={t("captionsLabel")}
                    src={media.captions[locale]}
                  />
                </video>
              </div>

              <div className="lg:flex lg:flex-col lg:border-l lg:border-white/10 lg:[&>*:first-child]:border-t-0">
                <p className="border-t border-white/10 px-4 py-3 text-[13px] leading-relaxed text-white/80 sm:px-5">
                  {t(`${copyKey}.disclosure`)}
                </p>

                <details className="border-t border-white/10 px-4 py-3 sm:px-5">
                  <summary className="cursor-pointer text-[13px] font-semibold text-white/85">
                    {t("transcriptTitle")}
                  </summary>
                  <p
                    id={transcriptId}
                    className="mt-2 max-h-40 overflow-y-auto text-[13px] leading-relaxed text-white/70"
                  >
                    {t(`${copyKey}.transcript`)}
                  </p>
                </details>
                <div className="border-t border-white/10 px-4 py-3 sm:px-5 lg:mt-auto">
                  <Link
                    href="/book-audit"
                    onClick={() =>
                      trackEvent("demo_video_audit_click", { locale, video })
                    }
                    className="inline-flex rounded-md bg-orange px-4 py-3 font-semibold text-navy"
                  >
                    {t("auditCta")}
                  </Link>
                  <p className="mt-2 text-sm text-white/75">{t("auditHint")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
