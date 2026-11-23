import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { WatchDemoButton } from "@/components/WatchDemoButton";
import { accentHeadline } from "@/components/home/accent-headline";
import {
  HomeHeroPreview,
  type HomeHeroPreviewCopy,
} from "@/components/home/HomeHeroPreview";

type HomeHeroProps = {
  eyebrow: string;
  headline: string;
  accentWord: string;
  subheadline: string;
  ctaPrimary: string;
  ctaSecondary: string;
  preview: HomeHeroPreviewCopy;
  /** Compact stack for phones; full Attio-style layout from `lg`. */
  compact?: boolean;
};

/**
 * Attio-inspired marketing hero: light canvas, centered copy, two CTAs, and a
 * framed product preview. No decorative motion or gradients.
 */
export function HomeHero({
  eyebrow,
  headline,
  accentWord,
  subheadline,
  ctaPrimary,
  ctaSecondary,
  preview,
  compact = false,
}: HomeHeroProps) {
  return (
    <section
      className={
        compact
          ? "relative overflow-hidden bg-white px-0 py-10 text-heading sm:py-12"
          : "relative overflow-hidden bg-white px-0 pt-[clamp(48px,6vw,88px)] pb-[clamp(40px,5vw,72px)] text-heading"
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[rgb(var(--ink-rgb)/0.08)]"
      />
      <Container className="relative">
        <div className="mx-auto max-w-[42rem] text-center">
          <p className="text-ui inline-flex items-center rounded-full border border-[rgb(var(--ink-rgb)/0.12)] bg-neutral-50 px-3 py-1 text-[12.5px] font-medium text-muted">
            {eyebrow}
          </p>

          <h1 className="text-hero mt-6 text-heading">
            {accentHeadline(headline, accentWord)}
          </h1>

          <p className="text-lede mx-auto mt-5 max-w-[34em] text-secondary">
            {subheadline}
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:justify-center">
            <WatchDemoButton className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-navy px-[26px] py-[17px] text-[16px] font-semibold tracking-[-0.01em] text-white transition-colors hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange sm:w-auto">
              {ctaPrimary}
            </WatchDemoButton>
            <CTAButton
              href="/pricing"
              variant="outline"
              size="lg"
              className="w-full justify-center sm:w-auto"
            >
              {ctaSecondary}
            </CTAButton>
          </div>
        </div>

        <div className={compact ? "mt-10" : "mt-[clamp(40px,5vw,64px)]"}>
          <HomeHeroPreview copy={preview} />
        </div>
      </Container>
    </section>
  );
}
