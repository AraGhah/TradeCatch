import { ArrowRight, ClipboardList, LayoutDashboard, PhoneCall, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { WatchDemoButton } from "@/components/WatchDemoButton";
import { HeroEntrance } from "@/components/ui/hero-entrance";
import { TradeCatchProductPreview } from "@/components/ui/tradecatch-product-preview";

/**
 * The home page hero: what TradeCatch does, in words on one side and as a call
 * moving through the product on the other. One hero for every screen size, so
 * the page has a single h1. Compact on purpose: no scroll pinning, and the
 * headline and both actions are on screen as soon as the page loads.
 */
export function TradeCatchCinematicHero({
  showScheduling = false,
}: {
  showScheduling?: boolean;
}) {
  const t = useTranslations("home.hero");
  const benefits = [
    { icon: PhoneCall, label: t("benefitReception") },
    { icon: ClipboardList, label: t("benefitRequests") },
    { icon: LayoutDashboard, label: t("benefitDashboard") },
  ];

  return (
    <section className="overflow-hidden border-b border-[rgb(var(--ink-rgb)/0.08)] bg-paper pt-[clamp(24px,4vw,56px)] pb-[clamp(32px,4.5vw,64px)] text-heading">
      <Container>
        <div className="mx-auto grid items-center gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="mx-auto w-full max-w-[36rem] min-w-0 text-center lg:mx-0 lg:text-left">
            <p className="m-0 text-[14px] font-bold text-ember-text">
              {t("eyebrow")}
            </p>

            <h1 className="mt-3 font-heading text-[clamp(2.1rem,4.4vw,3.75rem)] leading-[1.04] font-extrabold tracking-[-0.038em] text-heading">
              {t("headline")} {/* The underline marks the half that costs money. */}
              <span className="underline decoration-orange decoration-[0.09em] underline-offset-[0.13em] [text-decoration-skip-ink:none]">
                {t("highlight")}
              </span>
            </h1>

            <p className="mx-auto mt-5 mb-0 max-w-[32em] text-[clamp(16px,1.35vw,18px)] leading-[1.55] text-secondary lg:mx-0">
              {t("subheadline")}
            </p>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center lg:justify-start">
              <CTAButton href="/pricing" variant="ember" size="lg">
                {t("ctaPrimary")}
                <ArrowRight aria-hidden className="h-4 w-4" />
              </CTAButton>
              <WatchDemoButton className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] border-[1.5px] border-[rgb(var(--ink-rgb)/0.22)] bg-surface px-[26px] py-[15px] text-[16px] font-semibold tracking-[-0.01em] text-heading transition-colors hover:border-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange">
                <Play aria-hidden className="h-4 w-4" fill="currentColor" />
                {t("ctaSecondary")}
              </WatchDemoButton>
            </div>

            <p className="mt-3 mb-0">
              <CTAButton
                href="/book-audit"
                variant="link"
                className="min-h-8 text-[15px]"
              >
                {t("ctaContact")}
              </CTAButton>
            </p>

            <ul
              aria-label={t("benefitsLabel")}
              className="m-0 mt-5 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 border-t border-[rgb(var(--ink-rgb)/0.12)] p-0 pt-4 lg:justify-start"
            >
              {benefits.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-2 text-[14px] font-medium text-secondary"
                >
                  <Icon aria-hidden className="h-4 w-4 text-heading" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <HeroEntrance className="mx-auto w-full max-w-[540px] min-w-0">
            <TradeCatchProductPreview showScheduling={showScheduling} />
          </HeroEntrance>
        </div>
      </Container>
    </section>
  );
}
