import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { FaqAccordion } from "@/components/FaqAccordion";
import { FounderSection } from "@/components/FounderSection";
import { PricingPreview } from "@/components/PricingPreview";
import { HomeMobile } from "@/components/home/HomeMobile";
import { WatchDemoButton } from "@/components/WatchDemoButton";
import { StoryDemos } from "@/components/StoryDemos";
import { localizedAnchor } from "@/lib/anchors";
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

  const tryHref = localizedAnchor(locale, "/receptionist#try-it");
  const headline = t("hero.headline");
  const accentWord = t("hero.accentWord");
  const leakCards = t.raw("leaks.cards") as { title: string; body: string }[];
  const systemSteps = t.raw("system.steps") as {
    title: string;
    body: string;
  }[];

  return (
    <>
      <HomeMobile locale={locale} />

      <div className="hidden lg:block">
        {/* 1. Hero */}
        <section
          className="relative overflow-hidden bg-navy text-white"
          style={{
            padding: "clamp(40px, 5vw, 72px) 0 clamp(44px, 5.4vw, 80px)",
          }}
        >
          <div
            aria-hidden
            className="bg-grid-ink pointer-events-none absolute inset-0"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-[-160px] right-[-120px] h-[520px] w-[520px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(228,118,43,0.16), transparent 66%)",
            }}
          />
          <Container className="relative text-center">
            <div className="mx-auto max-w-[46rem]">
              <span className="inline-flex items-center gap-[9px] text-[13px] font-medium text-white/78">
                <span className="animate-tc-pulse block h-[7px] w-[7px] rounded-full bg-green" />
                {t("hero.eyebrow")}
              </span>

              <h1 className="text-hero mt-5 text-white">
                {accentHeadline(headline, accentWord)}
              </h1>

              <p className="text-lede mx-auto mt-4 max-w-[38em] text-white/72">
                {t("hero.subheadline")}
              </p>

              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <CTAButton href="/book-audit" variant="ember" size="lg">
                  {t("hero.ctaPrimary")}
                </CTAButton>
                <WatchDemoButton className="inline-flex items-center justify-center gap-2.5 rounded-[12px] border border-white/20 bg-transparent px-[26px] py-[17px] text-[16.5px] font-semibold tracking-[-0.01em] text-white transition-[translate,scale,background,border-color] duration-200 hover:translate-y-[-2px] active:scale-[0.97] hover:border-white/40 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2">
                  {cta("watchDemo")}
                </WatchDemoButton>
              </div>

              <CTAButton
                href={tryHref}
                variant="link-ink"
                className="mt-4 text-[15.5px]"
              >
                {t("hero.ctaTry")} <span aria-hidden>→</span>
              </CTAButton>

              <p className="mt-4 font-mono text-[11.5px] tracking-[0.1em] text-[rgba(255,255,255,0.7)] uppercase">
                {t("hero.reassurance")}
              </p>
            </div>
          </Container>
        </section>

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
              {leakCards.map((card, i) => (
                <li
                  key={card.title}
                  className="flex flex-col rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-paper p-6"
                >
                  <span className="font-mono text-[12px] font-semibold tracking-[0.08em] text-ember-text">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-heading text-[clamp(19px,1.7vw,22px)] leading-[1.2] font-bold tracking-[-0.028em] text-heading">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-[1.6] text-muted">
                    {card.body}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex justify-center">
              <CTAButton href="/book-audit" variant="ember">
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

            <div className="mt-[clamp(20px,2.4vw,28px)] grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {systemSteps.map((step, i) => (
                <div
                  key={step.title}
                  data-reveal
                  className={`rounded-[14px] p-5 ${
                    i === systemSteps.length - 1
                      ? "border border-orange/45 bg-[rgba(228,118,43,0.07)]"
                      : "border border-[rgb(var(--ink-rgb)/0.1)] bg-surface"
                  }`}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-heading text-[18px] leading-[1.25] font-bold tracking-[-0.028em] text-heading">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <WatchDemoButton
                className="inline-flex items-center justify-center gap-2.5 rounded-[11px] bg-orange px-[22px] py-[14px] text-[15px] font-semibold tracking-[-0.01em] text-navy shadow-cta transition-[translate,scale,background] duration-200 hover:translate-y-[-2px] active:scale-[0.97] hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t("proofExamples.demoCta")}
              </WatchDemoButton>
              <CTAButton href="/how-it-works" variant="secondary">
                {t("system.cta")} →
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
