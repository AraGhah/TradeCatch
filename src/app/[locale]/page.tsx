import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { FaqAccordion } from "@/components/FaqAccordion";
import { FounderSection } from "@/components/FounderSection";
import { PricingPreview } from "@/components/PricingPreview";
import { HomeMobile } from "@/components/home/HomeMobile";
import { HomeHero } from "@/components/home/HomeHero";
import type { HomeHeroPreviewCopy } from "@/components/home/HomeHeroPreview";
import { StoryDemos } from "@/components/StoryDemos";
import { WatchDemoButton } from "@/components/WatchDemoButton";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  return buildMetadata({
    locale,
    pathname: "/",
    title: t("hero.headline"),
    description: t("hero.subheadline"),
  });
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const cta = await getTranslations("cta");
  const site = await getTranslations("site");

  const leakCards = t.raw("leaks.cards") as { title: string; body: string }[];
  const systemSteps = t.raw("system.steps") as {
    title: string;
    body: string;
  }[];
  const heroPreview = t.raw("hero.preview") as HomeHeroPreviewCopy;

  return (
    <>
      <HomeMobile locale={locale} />

      <div className="hidden lg:block">
        <HomeHero
          eyebrow={t("hero.eyebrow")}
          headline={t("hero.headline")}
          accentWord={t("hero.accentWord")}
          subheadline={t("hero.subheadline")}
          ctaPrimary={t("hero.ctaPrimary")}
          ctaSecondary={t("hero.ctaSecondary")}
          preview={heroPreview}
        />

        {/* 2. The problem: where revenue leaks */}
        <section
          className="border-b border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
          style={{ padding: "var(--section-y) 0" }}
          data-reveal
        >
          <Container>
            <SectionHeading
              eyebrow={t("leaks.eyebrow")}
              title={t("leaks.headline")}
              intro={t("leaks.intro")}
            />

            <ol className="m-0 mt-[clamp(20px,2.4vw,28px)] grid list-none gap-5 p-0 lg:grid-cols-3">
              {leakCards.map((card) => (
                <li key={card.title} className="tc-card-quiet flex flex-col p-6">
                  <h3 className="text-card-title text-heading">{card.title}</h3>
                  <p className="mt-2 text-[15px] leading-[1.6] text-muted">
                    {card.body}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex justify-center">
              <CTAButton href="/book-audit" variant="ink">
                {t("leaks.cta")}
              </CTAButton>
            </div>
          </Container>
        </section>

        {/* 3. The system: how a missed call becomes a tracked outcome */}
        <section className="bg-paper" style={{ padding: "var(--section-y) 0" }}>
          <Container>
            <div data-reveal>
              <SectionHeading
                eyebrow={t("system.eyebrow")}
                title={t("system.headline")}
                intro={t("system.intro")}
              />
            </div>

            <ol className="m-0 mt-[clamp(20px,2.4vw,28px)] grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {systemSteps.map((step, i) => (
                <li key={step.title} data-reveal className="tc-card p-5">
                  <p className="text-ui text-[12px] font-medium text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="text-card-title mt-2 text-heading">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <WatchDemoButton className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-navy px-[22px] py-[14px] text-[15px] font-semibold tracking-[-0.01em] text-white transition-colors hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange">
                {t("proofExamples.demoCta")}
              </WatchDemoButton>
              <CTAButton href="/how-it-works" variant="secondary">
                {t("system.cta")}
              </CTAButton>
            </div>
          </Container>
        </section>

        {/* 3b. The one public demo video */}
        <StoryDemos locale={locale} id="on-the-job" />

        {/* 4. The two plans (full detail lives on /pricing) */}
        <section
          id="plans"
          className="scroll-mt-28 border-y border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
          style={{ padding: "var(--section-y) 0" }}
        >
          <Container>
            <PricingPreview
              eyebrow={t("pricingPreview.eyebrow")}
              headline={t("pricingPreview.headline")}
              intro={t("pricingPreview.intro")}
              tiers={t.raw("pricingPreview.tiers")}
              cta={t("pricingPreview.cta")}
              receptionistCta={t("pricingPreview.receptionistCta")}
              note={t("pricingPreview.note")}
              billingNote={t("pricingPreview.billingNote")}
              recommendedIndex={1}
            />
          </Container>
        </section>

        {/* 5. Founder: who builds and runs the system */}
        <section
          className="bg-paper"
          style={{ padding: "var(--section-y) 0" }}
          data-reveal
        >
          <Container>
            <FounderSection
              eyebrow={t("founder.eyebrow")}
              headline={t("founder.headline")}
              name={t("founder.name")}
              role={t("founder.role")}
              floatLabel={t("founder.floatLabel")}
              statement={t("founder.statement")}
              points={t.raw("founder.points")}
              workLabel={t("founder.workLabel")}
              work={t.raw("founder.work")}
              emailLabel={cta("emailDirect")}
              email={site("founderEmail")}
              talkCta={t("founder.talkCta")}
            />
          </Container>
        </section>

        {/* 6. Objections */}
        <section
          className="border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
          style={{ padding: "var(--section-y) 0" }}
        >
          <Container>
            <div
              className="grid items-start"
              style={{
                gap: "clamp(20px, 3vw, 40px)",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              }}
            >
              <div data-reveal className="max-w-[min(100%,28rem)]">
                <SectionHeading
                  align="left"
                  eyebrow={t("faqTeaser.eyebrow")}
                  title={t("faqTeaser.headline")}
                />
                <CTAButton href="/faq" variant="secondary" className="mt-5">
                  {t("faqTeaser.viewAll")}
                </CTAButton>
              </div>
              <div
                data-reveal
                className="min-w-0 border-t border-[rgb(var(--ink-rgb)/0.12)]"
              >
                <FaqAccordion items={t.raw("faqTeaser.items")} />
              </div>
            </div>
          </Container>
        </section>

        {/* 7. Final call to action */}
        <section
          className="bg-navy text-white"
          style={{ padding: "var(--section-y) 0" }}
        >
          <Container className="text-center">
            <h2 className="font-heading text-[clamp(28px,3.2vw,40px)] font-extrabold leading-[1.08] tracking-[-0.04em] text-white">
              {t("mobile.finalCta.headline")}
            </h2>
            <p className="text-lede mx-auto mt-3 max-w-[36em] text-white/75">
              {t("mobile.finalCta.body")}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <CTAButton href="/book-audit" variant="ember" size="lg">
                {t("mobile.finalCta.primary")}
              </CTAButton>
              <CTAButton href="/pricing" variant="ghost-ink" size="lg">
                {t("mobile.finalCta.secondary")}
              </CTAButton>
            </div>
            <p className="mt-4 text-[14px] text-white/65">
              {t("mobile.finalCta.note")}
            </p>
          </Container>
        </section>
      </div>
    </>
  );
}
