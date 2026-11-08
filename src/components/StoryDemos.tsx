import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { CTAButton } from "@/components/CTAButton";
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
 * "See it on the job": the one public demo video (see stories.ts). On a wide
 * screen it is two columns: the pitch (headline, three short benefits, the
 * demo buttons) beside the video card; on a phone they stack. The card is the
 * opener button of the shared WatchDemoButton dialog, which holds the player,
 * its controls and captions. The card keeps its 4:5 picture, and the honesty
 * note (a dramatization with a fictional business) always sits next to it, not
 * only inside the dialog. Server component.
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
  const cta = await getTranslations("cta");
  const lang = locale.startsWith("fr") ? "fr" : "en";
  const key = STORY_COPY_KEY[DEFAULT_STORY_ID];
  const media = STORY_MEDIA[DEFAULT_STORY_ID];
  const title = t(`cards.${key}.title`);
  const benefits = t.raw("benefits") as string[];

  return (
    <section
      id={id}
      className={`scroll-mt-24 border-y border-[rgb(var(--ink-rgb)/0.08)] bg-paper ${
        compact ? "py-8 sm:py-10" : ""
      }`}
      style={compact ? undefined : { padding: "var(--section-y) 0" }}
    >
      <Container>
        <div
          data-reveal
          className="grid items-center gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-[clamp(40px,6vw,88px)]"
        >
          <div className="max-w-[36rem] lg:max-w-none">
            <SectionHeading
              align="left"
              eyebrow={t("eyebrow")}
              title={t("headline")}
              intro={t("intro")}
              className="max-w-none"
            />

            <ul className="m-0 mt-5 flex list-none flex-col gap-2.5 p-0">
              {benefits.map((benefit) => (
                <li
                  key={benefit}
                  className="flex items-start gap-3 text-[15.5px] leading-[1.5] text-secondary"
                >
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-orange"
                  />
                  {benefit}
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <CTAButton href="/book-audit" variant="ember">
                {cta("bookFreeDemo")}
              </CTAButton>
              <WatchDemoButton
                video={DEFAULT_STORY_ID}
                className="inline-flex items-center justify-center gap-2 rounded-[11px] border-[1.5px] border-[rgb(var(--ink-rgb)/0.18)] px-[22px] py-[13px] text-[15px] font-semibold tracking-[-0.01em] text-heading transition-[translate,border-color] duration-200 hover:-translate-y-[2px] hover:border-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
              >
                {cta("watchDemo")}
              </WatchDemoButton>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[360px] lg:mx-0">
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
                  sizes="(min-width: 1024px) 360px, 92vw"
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
              <span className="block p-4">
                <span className="block font-heading text-[18px] font-bold tracking-[-0.028em] text-heading">
                  {title}
                </span>
                <span className="mt-1.5 block text-[14px] leading-[1.5] text-muted">
                  {t(`cards.${key}.blurb`)}
                </span>
              </span>
            </WatchDemoButton>
            <p className="mt-3 text-[13px] leading-[1.5] text-muted">
              {t("note")}
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
