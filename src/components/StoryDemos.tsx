import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { WatchDemoButton } from "@/components/WatchDemoButton";
import {
  DEFAULT_STORY_ID,
  STORY_COPY_KEY,
  STORY_MEDIA,
  formatRunTime,
} from "@/components/demo-video/stories";

function PlayGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-9 w-9 drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
    >
      <circle cx="12" cy="12" r="12" fill="#e4762b" />
      <path d="M9.5 7.6v8.8l7.2-4.4z" fill="#0c141e" />
    </svg>
  );
}

/**
 * "See it on the job": the one public demo video (see stories.ts). The card is
 * the opener button of the shared WatchDemoButton dialog. Server component.
 * Always renders the honesty note next to the card, not only inside the
 * dialog.
 */
export async function StoryDemos({
  locale,
  id,
  compact = false,
}: {
  locale: string;
  id?: string;
  /** Tighter vertical rhythm for the mobile homepage composition. */
  compact?: boolean;
}) {
  const t = await getTranslations("demoStories");
  const lang = locale.startsWith("fr") ? "fr" : "en";
  const key = STORY_COPY_KEY[DEFAULT_STORY_ID];
  const media = STORY_MEDIA[DEFAULT_STORY_ID];
  const title = t(`cards.${key}.title`);

  return (
    <section
      id={id}
      className={`scroll-mt-24 border-y border-[rgb(var(--ink-rgb)/0.08)] bg-paper ${
        compact ? "py-10 sm:py-12" : ""
      }`}
      style={compact ? undefined : { padding: "var(--section-y) 0" }}
    >
      <Container>
        <div data-reveal>
          <SectionHeading
            eyebrow={t("eyebrow")}
            title={t("headline")}
            intro={t("intro")}
          />
        </div>

        <div className="mx-auto mt-[clamp(32px,4vw,48px)] max-w-[360px]">
          <WatchDemoButton
            video={DEFAULT_STORY_ID}
            ariaLabel={t("watchLabel", { title })}
            className="group block h-full w-full overflow-hidden rounded-[14px] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface text-left transition-[translate,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_18px_40px_-22px_rgba(12,20,30,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            <span className="relative block aspect-[4/5] overflow-hidden bg-navy">
              <Image
                src={media.poster}
                alt=""
                fill
                unoptimized
                sizes="(min-width: 640px) 360px, 92vw"
                className="object-cover transition-transform duration-500 group-hover:scale-[1.035]"
              />
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-navy/75 via-navy/5 to-transparent"
              />
              <span className="absolute bottom-3 left-3 inline-flex items-center gap-2.5 text-white">
                <PlayGlyph />
                <span className="font-mono text-[12.5px] font-semibold">
                  {formatRunTime(media.seconds[lang])}
                </span>
              </span>
            </span>
            <span className="block p-4 sm:p-5">
              <span className="block font-heading text-[19px] font-bold tracking-[-0.028em] text-heading">
                {title}
              </span>
              <span className="mt-2 block text-[14.5px] leading-[1.55] text-muted">
                {t(`cards.${key}.blurb`)}
              </span>
            </span>
          </WatchDemoButton>
        </div>

        <p className="mx-auto mt-7 max-w-[46rem] text-center text-[13px] leading-[1.55] text-muted">
          {t("note")}
        </p>
      </Container>
    </section>
  );
}
