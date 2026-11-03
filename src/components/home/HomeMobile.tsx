import { getTranslations } from "next-intl/server";
import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { FaqAccordion } from "@/components/FaqAccordion";
import { StickyAuditCta } from "@/components/StickyAuditCta";
import { StoryDemos } from "@/components/StoryDemos";
import { WatchDemoButton } from "@/components/WatchDemoButton";
import { WebsiteServiceAddOn } from "@/components/WebsiteServiceAddOn";
import { formatPlanMoney, PLAN_PRICES } from "@/lib/plans";
import { localizedAnchor } from "@/lib/anchors";
import { websiteServiceAddOn } from "@/lib/plan-marketing";

function accentHeadline(headline: string, accentWord: string) {
  const idx = headline.lastIndexOf(accentWord);
  if (idx === -1) return headline;
  return (
    <>
      {headline.slice(0, idx)}
      <span className="text-orange">{accentWord}</span>
      {headline.slice(idx + accentWord.length)}
    </>
  );
}

const SECTION =
  "border-b border-[rgb(var(--ink-rgb)/0.08)] px-0 py-10 sm:py-12";

/**
 * Mobile-first homepage composition. Hidden from `lg` up so desktop keeps
 * the existing long-form layout in page.tsx.
 */
export async function HomeMobile({ locale }: { locale: string }) {
  const t = await getTranslations("home");
  const cta = await getTranslations("cta");
  const plans = await getTranslations("plans");
  const tryHref = localizedAnchor(locale, "/receptionist#try-it");
  const headline = t("hero.headline");
  const accentWord = t("hero.accentWord");
  const benefits = t.raw("mobile.benefits.items") as {
    title: string;
    body: string;
  }[];
  const steps = t.raw("mobile.howItWorks.steps") as {
    title: string;
    body: string;
  }[];
  const useCases = t.raw("mobile.useCases.items") as {
    problem: string;
    response: string;
  }[];
  const faqItems = t.raw("faqTeaser.items") as { q: string; a: string }[];
  const previewTiers = t.raw("pricingPreview.tiers") as { name: string }[];
  const addOn = websiteServiceAddOn();
  const websiteServiceCopy = {
    eyebrow: t("mobile.addOn.eyebrow"),
    title: t("mobile.addOn.headline"),
    intro: t("mobile.addOn.intro"),
    price: plans("addOns.websiteService.price"),
    priceNote: plans("addOns.websiteService.priceNote"),
    availableOn: plans("addOns.websiteService.availableOn"),
    neverIncluded: plans("addOns.websiteService.neverIncluded"),
    includesTitle: plans("addOns.websiteService.includesTitle"),
    includes: plans.raw("addOns.websiteService.includes") as string[],
    cta: t("mobile.addOn.cta"),
  };
  const tags = [
    t("mobile.pricing.starterTag"),
    t("mobile.pricing.growthTag"),
    t("mobile.pricing.plusTag"),
  ];
  const planIds = ["starter", "growth", "receptionist"] as const;
  const planNames = previewTiers.map((tier) => tier.name);

  return (
    <div className="lg:hidden">
      {/* 1. Hero */}
      <section className="relative overflow-hidden bg-navy px-0 py-12 text-white sm:py-14">
        <div
          aria-hidden
          className="bg-grid-ink pointer-events-none absolute inset-0"
        />
        <Container className="relative">
          <span className="inline-flex items-center gap-2 text-[12px] font-medium text-white/75">
            <span className="block h-1.5 w-1.5 rounded-full bg-green" />
            {t("hero.eyebrow")}
          </span>
          <h1 className="mt-4 font-heading text-[clamp(1.85rem,7.2vw,2.45rem)] font-extrabold leading-[1.08] tracking-[-0.04em] text-white">
            {accentHeadline(headline, accentWord)}
          </h1>
          <p className="mt-4 max-w-[34em] text-[15.5px] leading-[1.55] text-white/70">
            {t("hero.subheadline")}
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <CTAButton
              href="/book-audit"
              variant="ember"
              size="lg"
              className="w-full justify-center"
            >
              {t("hero.ctaPrimary")}
            </CTAButton>
            <WatchDemoButton className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-white/25 bg-transparent px-5 py-3.5 text-[15px] font-semibold text-white">
              {cta("watchDemo")}
            </WatchDemoButton>
          </div>
          <p className="mt-5 text-[12.5px] leading-[1.45] text-white/55">
            {t("hero.reassurance")}
          </p>
        </Container>
      </section>

      {/* 2. Demo */}
      <section id="demo" className={`${SECTION} scroll-mt-24 bg-surface`}>
        <Container>
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-ember-text uppercase">
            {t("mobile.demo.eyebrow")}
          </p>
          <h2 className="mt-2 font-heading text-[clamp(1.45rem,5.5vw,1.9rem)] font-extrabold tracking-[-0.035em] text-heading">
            {t("mobile.demo.headline")}
          </h2>
          <p className="mt-2 text-[15px] leading-[1.55] text-muted">
            {t("mobile.demo.intro")}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <WatchDemoButton className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-orange px-5 py-3.5 text-[15px] font-semibold text-navy shadow-cta">
              {t("mobile.demo.watchVideo")}
            </WatchDemoButton>
            <CTAButton
              href={tryHref}
              variant="secondary"
              className="w-full justify-center"
            >
              {t("mobile.demo.tryLive")}
            </CTAButton>
          </div>
          <p className="mt-3 text-[13px] text-muted">{t("mobile.demo.note")}</p>
        </Container>
      </section>

      {/* 2b. Three short dramatizations: the product on the job */}
      <StoryDemos locale={locale} compact />

      {/* 3. Benefits */}
      <section className={`${SECTION} bg-paper`}>
        <Container>
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-ember-text uppercase">
            {t("mobile.benefits.eyebrow")}
          </p>
          <h2 className="mt-2 font-heading text-[clamp(1.45rem,5.5vw,1.9rem)] font-extrabold tracking-[-0.035em] text-heading">
            {t("mobile.benefits.headline")}
          </h2>
          <p className="mt-2 text-[15px] leading-[1.55] text-muted">
            {t("mobile.benefits.intro")}
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-3">
            {benefits.map((item) => (
              <li
                key={item.title}
                className="rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-3.5"
              >
                <h3 className="font-heading text-[14.5px] font-bold leading-snug tracking-[-0.02em] text-heading">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-[12.5px] leading-[1.45] text-muted">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* 4. How it works */}
      <section className={`${SECTION} bg-surface`}>
        <Container>
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-ember-text uppercase">
            {t("mobile.howItWorks.eyebrow")}
          </p>
          <h2 className="mt-2 font-heading text-[clamp(1.45rem,5.5vw,1.9rem)] font-extrabold tracking-[-0.035em] text-heading">
            {t("mobile.howItWorks.headline")}
          </h2>
          <p className="mt-2 text-[15px] leading-[1.55] text-muted">
            {t("mobile.howItWorks.intro")}
          </p>
          <ol className="mt-6 m-0 flex list-none flex-col gap-3 p-0">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="flex gap-3 rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-paper p-4"
              >
                <span className="font-mono text-[12px] font-semibold text-ember-text">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-heading text-[16px] font-bold tracking-[-0.025em] text-heading">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-[14px] leading-[1.5] text-muted">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <CTAButton
            href="/how-it-works"
            variant="secondary"
            className="mt-6 w-full justify-center"
          >
            {t("mobile.howItWorks.cta")}
          </CTAButton>
        </Container>
      </section>

      {/* 5. Use cases */}
      <section className={`${SECTION} bg-paper`}>
        <Container>
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-ember-text uppercase">
            {t("mobile.useCases.eyebrow")}
          </p>
          <h2 className="mt-2 font-heading text-[clamp(1.45rem,5.5vw,1.9rem)] font-extrabold tracking-[-0.035em] text-heading">
            {t("mobile.useCases.headline")}
          </h2>
          <p className="mt-2 text-[15px] leading-[1.55] text-muted">
            {t("mobile.useCases.intro")}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {useCases.map((item) => (
              <details
                key={item.problem}
                className="group rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-4 py-3"
              >
                <summary className="cursor-pointer list-none font-heading text-[15px] font-bold tracking-[-0.02em] text-heading marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-start justify-between gap-3">
                    {item.problem}
                    <span
                      className="text-muted transition group-open:rotate-45"
                      aria-hidden
                    >
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-2 border-t border-[rgb(var(--ink-rgb)/0.08)] pt-2 text-[14px] leading-[1.5] text-muted">
                  {item.response}
                </p>
              </details>
            ))}
          </div>
          <CTAButton href="/industries" variant="link-ink" className="mt-5">
            {t("mobile.useCases.cta")} →
          </CTAButton>
        </Container>
      </section>

      {/* 6. Pricing */}
      <section id="plans" className={`${SECTION} scroll-mt-24 bg-surface`}>
        <Container>
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-ember-text uppercase">
            {t("mobile.pricing.eyebrow")}
          </p>
          <h2 className="mt-2 font-heading text-[clamp(1.45rem,5.5vw,1.9rem)] font-extrabold tracking-[-0.035em] text-heading">
            {t("mobile.pricing.headline")}
          </h2>
          <p className="mt-2 text-[15px] leading-[1.55] text-muted">
            {t("mobile.pricing.intro")}
          </p>
          <p className="mt-3 rounded-[12px] border border-orange/30 bg-[rgba(228,118,43,0.08)] px-3.5 py-2.5 text-[13.5px] leading-[1.45] text-heading">
            {t("mobile.pricing.billingNote")}
          </p>
          <ol className="mt-6 m-0 flex list-none flex-col gap-3 p-0">
            {planIds.map((id, i) => {
              const prices = PLAN_PRICES[id];
              const recommended = id === "growth";
              return (
                <li
                  key={id}
                  className={`rounded-[16px] border p-4 ${
                    recommended
                      ? "border-orange/45 bg-paper ring-1 ring-orange/15"
                      : "border-[rgb(var(--ink-rgb)/0.1)] bg-paper"
                  }`}
                >
                  {recommended ? (
                    <p className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ember-text uppercase">
                      {t("mobile.pricing.recommended")}
                    </p>
                  ) : null}
                  <h3 className="font-heading text-[20px] font-extrabold tracking-[-0.03em] text-heading">
                    {planNames[i]}
                  </h3>
                  <p className="mt-1 text-[14px] leading-[1.45] text-secondary">
                    {tags[i]}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-[11px] tracking-[0.06em] text-muted uppercase">
                        {t("mobile.pricing.setupLabel")}
                      </dt>
                      <dd className="mt-0.5 font-heading text-[18px] font-bold text-heading">
                        {formatPlanMoney(prices.setup, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.06em] text-muted uppercase">
                        {t("mobile.pricing.monthlyLabel")}
                      </dt>
                      <dd className="mt-0.5 font-heading text-[18px] font-bold text-orange">
                        {formatPlanMoney(prices.monthly, locale)}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 flex flex-col gap-3">
            <CTAButton
              href="/pricing"
              variant="ink"
              className="w-full justify-center"
            >
              {t("mobile.pricing.seeAll")}
            </CTAButton>
            <CTAButton
              href="/receptionist"
              variant="secondary"
              className="w-full justify-center"
            >
              {t("pricingPreview.receptionistCta")}
            </CTAButton>
          </div>
        </Container>
      </section>

      {/* 7. Add-on */}
      <section className={`${SECTION} bg-paper`}>
        <Container>
          <WebsiteServiceAddOn copy={websiteServiceCopy} />
          <p className="sr-only">
            {addOn.priceCad} CAD optional website service
          </p>
        </Container>
      </section>

      {/* 8. FAQ */}
      <section className={`${SECTION} bg-surface`}>
        <Container>
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-ember-text uppercase">
            {t("mobile.faq.eyebrow")}
          </p>
          <h2 className="mt-2 font-heading text-[clamp(1.45rem,5.5vw,1.9rem)] font-extrabold tracking-[-0.035em] text-heading">
            {t("mobile.faq.headline")}
          </h2>
          <div className="mt-5 border-t border-[rgb(var(--ink-rgb)/0.12)]">
            <FaqAccordion items={faqItems} />
          </div>
          <CTAButton
            href="/faq"
            variant="secondary"
            className="mt-6 w-full justify-center"
          >
            {t("mobile.faq.viewAll")}
          </CTAButton>
        </Container>
      </section>

      {/* 9. Final CTA */}
      <section className="bg-navy px-0 py-12 text-white">
        <Container>
          <h2 className="font-heading text-[clamp(1.55rem,6vw,2.1rem)] font-extrabold tracking-[-0.04em] text-white">
            {t("mobile.finalCta.headline")}
          </h2>
          <p className="mt-3 max-w-[34em] text-[15px] leading-[1.55] text-white/70">
            {t("mobile.finalCta.body")}
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <CTAButton
              href="/book-audit"
              variant="ember"
              size="lg"
              className="w-full justify-center"
            >
              {t("mobile.finalCta.primary")}
            </CTAButton>
            <CTAButton
              href="/pricing"
              variant="secondary"
              className="w-full justify-center !border-white/25 !text-white hover:!bg-white/10"
            >
              {t("mobile.finalCta.secondary")}
            </CTAButton>
          </div>
          <p className="mt-5 text-[13px] text-white/55">
            {t("mobile.finalCta.note")}
          </p>
          <p className="mt-4 text-[13px] text-white/45">
            {cta("bookFreeDemo")} · TradeCatch
          </p>
        </Container>
      </section>

      <StickyAuditCta label={t("mobile.stickyCta")} />
    </div>
  );
}
