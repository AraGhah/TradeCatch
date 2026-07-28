import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { HeroMockup } from "@/components/HeroMockup";
import { HeroBackground } from "@/components/HeroBackground";
import { DashboardPreview } from "@/components/DashboardPreview";
import { ComparisonPanel } from "@/components/ComparisonPanel";
import { FaqAccordion } from "@/components/FaqAccordion";
import { FounderSection } from "@/components/FounderSection";
import { ProofExamplesSection } from "@/components/ProofExamplesSection";
import { WorkflowPreview } from "@/components/WorkflowPreview";
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

  const headline = t("hero.headline");
  const accentWord = t("hero.accentWord");
  const trustChips = t.raw("hero.trustChips") as string[];
  const demoStripSteps = t.raw("hero.demoStripSteps") as string[];
  const trustStrip = t.raw("trustStrip.items") as {
    title: string;
    body: string;
  }[];
  const leakCards = t.raw("leaks.cards") as { title: string; body: string }[];
  const systemSteps = t.raw("system.steps") as { title: string; body: string }[];
  const systemPreview = t.raw("system.previewSteps") as string[];
  const industries = t.raw("industries.priority") as {
    name: string;
    pain: string;
  }[];
  const supporting = t.raw("industries.supporting") as string[];
  const pilotPoints = t.raw("pilot.points") as string[];
  const expect = t.raw("finalCta.whatToExpect") as string[];
  const pricingTiers = t.raw("pricingPreview.tiers") as {
    name: string;
    price: string;
    cadence: string;
    idealFor: string;
  }[];
  const mockMessages = t.raw("hero.mockup.messages") as {
    type: "event" | "out" | "in" | "photo" | "win";
    text: string;
    time?: string;
  }[];

  return (
    <>
      {/* 1. Hero */}
      <section
        className="relative overflow-hidden bg-navy text-white"
        style={{
          padding: "clamp(56px, 7vw, 96px) 0 clamp(72px, 8vw, 120px)",
        }}
      >
        <HeroBackground />
        <Container className="relative">
          <div
            className="grid items-center"
            style={{
              gap: "clamp(40px, 5vw, 72px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
            }}
          >
            <div>
              <span className="inline-flex items-center gap-[9px] text-[13px] font-medium text-white/78">
                <span className="block h-[7px] w-[7px] animate-tc-pulse rounded-full bg-green" />
                {t("hero.eyebrow")}
              </span>

              <h1 className="text-hero mt-[26px] text-white">
                {accentHeadline(headline, accentWord)}
              </h1>

              <p className="text-lede mt-[26px] max-w-[36em] text-white/68">
                {t("hero.subheadline")}
              </p>

              <p className="mt-4 max-w-[34em] text-[15px] leading-[1.55] text-white/52">
                {t("hero.qualificationLine")}
              </p>

              <div className="mt-[34px] flex flex-wrap gap-3">
                <CTAButton href="/book-audit" variant="ember" size="lg">
                  {t("hero.ctaPrimary")}
                </CTAButton>
                <WatchDemoButton className="inline-flex items-center justify-center gap-2.5 rounded-[12px] border border-white/20 bg-transparent px-[26px] py-[17px] text-[16.5px] font-semibold tracking-[-0.01em] text-white transition-[transform,background,border-color] duration-200 hover:translate-y-[-2px] hover:border-white/40 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2">
                  {t("hero.ctaSecondary")}
                </WatchDemoButton>
              </div>

              <p className="mt-[18px] font-mono text-[11.5px] tracking-[0.1em] text-[rgba(255,255,255,0.64)] uppercase">
                {t("hero.reassurance")}
              </p>

              <div className="mt-9 border-t border-white/10 pt-[26px]">
                <p className="font-mono text-[10.5px] tracking-[0.12em] text-white/45 uppercase">
                  {t("hero.demoStripLabel")}
                </p>
                <ol className="mt-3.5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
                  {demoStripSteps.map((step, i) => (
                    <li key={step} className="flex items-center gap-1.5">
                      <span className="rounded-md border border-white/12 bg-white/[0.06] px-2.5 py-1.5 text-[12.5px] font-medium text-white/85">
                        {step}
                      </span>
                      {i < demoStripSteps.length - 1 ? (
                        <span className="text-orange/80" aria-hidden>
                          →
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
                <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {trustChips.map((chip) => (
                    <li
                      key={chip}
                      className="text-[13px] leading-none text-white/55"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <HeroMockup
              businessName={t("hero.mockup.businessName")}
              avatar={t("hero.mockup.avatar")}
              autoReply={t("hero.mockup.autoReply")}
              statusTime={t("hero.mockup.statusTime")}
              statusNetwork={t("hero.mockup.statusNetwork")}
              disclaimer={t("hero.mockup.disclaimer")}
              floatLabel={t("hero.mockup.floatCard.label")}
              floatTitle={t("hero.mockup.floatCard.title")}
              messages={mockMessages}
            />
          </div>
        </Container>
      </section>

      {/* 2. Trust strip */}
      <section
        className="border-b border-[rgba(12,20,30,0.08)] bg-white"
        style={{ padding: "clamp(28px, 4vw, 40px) 0" }}
      >
        <Container>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {trustStrip.map((item) => (
              <div
                key={item.title}
                className="border border-[rgba(12,20,30,0.08)] bg-paper px-4 py-4"
              >
                <p className="text-[14px] font-semibold tracking-[-0.01em] text-navy">
                  {item.title}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 3. Live workflow (system) */}
      <section
        className="bg-paper"
        style={{ padding: "clamp(72px, 8vw, 96px) 0 clamp(56px, 6vw, 72px)" }}
      >
        <Container>
          <div
            data-reveal
            className="grid items-center"
            style={{
              gap: "clamp(40px, 6vw, 80px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            }}
          >
            <div className="max-w-[520px]">
              <p className="text-[13px] font-medium text-ember-text">
                {t("system.eyebrow")}
              </p>
              <h2
                className="mt-4 font-heading font-extrabold text-navy"
                style={{
                  fontSize: "clamp(40px, 5vw, 68px)",
                  lineHeight: 0.95,
                  letterSpacing: "-0.05em",
                  maxWidth: "520px",
                }}
              >
                {t("system.headline")}
              </h2>
              <p className="mt-6 max-w-[460px] text-[17px] leading-[1.6] text-muted">
                {t("system.intro")}
              </p>
              <CTAButton
                href="/how-it-works"
                variant="link"
                className="mt-7"
              >
                {t("system.cta")} →
              </CTAButton>
            </div>

            <WorkflowPreview
              steps={systemPreview}
              label={t("system.previewLabel")}
            />
          </div>

          <div
            className="mt-[clamp(48px,5vw,64px)] grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {systemSteps.map((step, i) => (
              <div
                key={step.title}
                data-reveal
                className="border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(24px,3vw,32px)] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[rgba(12,20,30,0.2)]"
              >
                <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 font-heading text-[19.5px] font-bold tracking-[-0.028em] text-navy">
                  {step.title}
                </h3>
                <p className="mt-2 text-[15px] leading-[1.6] text-muted">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 4. Revenue leaks */}
      <section
        className="border-y border-[rgba(12,20,30,0.08)] bg-white"
        style={{ padding: "var(--section-y) 0" }}
        data-reveal
      >
        <Container>
          <div
            className="grid items-start"
            style={{
              gap: "clamp(28px, 4vw, 64px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <div className="sticky top-[120px] max-w-[34rem]">
              <SectionHeading
                align="left"
                eyebrow={t("leaks.eyebrow")}
                title={t("leaks.headline")}
                intro={t("leaks.intro")}
              />
              <CTAButton
                href="/book-audit"
                variant="ember"
                className="mt-[30px]"
              >
                {t("leaks.cta")}
              </CTAButton>
            </div>

            <div className="flex flex-col">
              {leakCards.map((card, i) => (
                <div
                  key={card.title}
                  data-reveal
                  className={`grid gap-[clamp(18px,3vw,34px)] py-[34px] transition-colors duration-200 hover:bg-paper/80 ${
                    i === leakCards.length - 1
                      ? "border-y border-[rgba(12,20,30,0.12)]"
                      : "border-t border-[rgba(12,20,30,0.12)]"
                  }`}
                  style={{ gridTemplateColumns: "auto 1fr" }}
                >
                  <span className="pt-1.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-ember-text">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-heading text-[clamp(21px,2.2vw,27px)] font-bold tracking-[-0.028em] text-navy">
                      {card.title}
                    </h3>
                    <p className="mt-2.5 max-w-[44em] text-[16px] leading-[1.65] text-muted">
                      {card.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* 5. Proof examples (illustrative only — no fabricated results) */}
      <section
        id="proof-examples"
        className="bg-paper scroll-mt-28"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <ProofExamplesSection
            eyebrow={t("proofExamples.eyebrow")}
            headline={t("proofExamples.headline")}
            intro={t("proofExamples.intro")}
            illustrativeLabel={t("proofExamples.illustrativeLabel")}
            sms={t.raw("proofExamples.sms")}
            alert={t.raw("proofExamples.alert")}
            quoteHeadline={t("proofExamples.quoteHeadline")}
            quoteBadge={t("proofExamples.quoteBadge")}
            quoteSteps={t.raw("proofExamples.quoteSteps")}
            demoCta={t("proofExamples.demoCta")}
            onePagerCta={t("proofExamples.onePagerCta")}
          />
        </Container>
      </section>

      {/* 6. Before / after */}
      <section
        className="bg-white"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <SectionHeading
              align="left"
              eyebrow={t("comparison.eyebrow")}
              title={t("comparison.headline")}
              className="max-w-[min(100%,34rem)]"
            />
          </div>
          <div data-reveal className="mt-[clamp(36px,4vw,56px)]">
            <ComparisonPanel
              manualLabel={t("comparison.manualLabel")}
              systemLabel={t("comparison.systemLabel")}
              rows={t.raw("comparison.rows")}
            />
          </div>
        </Container>
      </section>

      {/* 7. Dashboard */}
      <section
        className="bg-navy text-white"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div
            className="grid items-center"
            style={{
              gap: "clamp(32px, 5vw, 72px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            <div data-reveal>
              <SectionHeading
                align="left"
                light
                eyebrow={t("dashboard.eyebrow")}
                title={t("dashboard.headline")}
                intro={t("dashboard.intro")}
              />
              <CTAButton
                href="/book-audit"
                variant="ember"
                className="mt-[30px]"
              >
                {t("dashboard.cta")}
              </CTAButton>
            </div>
            <div data-reveal>
              <DashboardPreview
                period={t("dashboard.period")}
                liveLabel={t("dashboard.live")}
                sampleDataLabel={t("dashboard.sampleDataLabel")}
                metrics={t.raw("dashboard.metrics")}
              />
            </div>
          </div>
        </Container>
      </section>

      {/* 8. Industries */}
      <section
        className="bg-paper"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div
            data-reveal
            className="grid items-end"
            style={{
              gap: "clamp(24px, 4vw, 48px)",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
            }}
          >
            <SectionHeading
              align="left"
              eyebrow={t("industries.eyebrow")}
              title={t("industries.headline")}
              className="max-w-[min(100%,34rem)]"
            />
            <div className="flex flex-col items-start gap-4 sm:items-end sm:text-right">
              <p className="max-w-[28em] text-[16px] leading-[1.6] text-muted sm:ml-auto">
                {t("industries.leadIn")}
              </p>
              <CTAButton href="/industries" variant="link">
                {t("industries.cta")} →
              </CTAButton>
            </div>
          </div>

          <div
            className="mt-[clamp(32px,4vw,52px)] grid"
            style={{
              gap: "clamp(14px, 2vw, 22px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            {industries.map((card) => (
              <div
                key={card.name}
                data-reveal
                className="rounded-2xl border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(26px,3vw,34px)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-[5px] hover:border-[rgba(12,20,30,0.2)] hover:shadow-card-hover"
              >
                <span className="font-mono text-[10.5px] tracking-[0.14em] text-ember-text uppercase">
                  {t("industries.priorityLabel")}
                </span>
                <h3 className="mt-4 font-heading text-2xl font-bold tracking-[-0.03em] text-navy">
                  {card.name}
                </h3>
                <p className="mt-2.5 text-[15.5px] leading-[1.62] text-muted">
                  {card.pain}
                </p>
              </div>
            ))}
          </div>

          <div
            data-reveal
            className="mt-[34px] flex flex-wrap items-center gap-2.5"
          >
            <span className="mr-1.5 font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase">
              {t("industries.supportingLabel")}
            </span>
            {supporting.map((trade) => (
              <span
                key={trade}
                className="rounded-full border border-[rgba(12,20,30,0.13)] bg-white/55 px-[15px] py-2 text-[14px] text-[#4B5764] transition-colors duration-200 hover:border-navy hover:bg-white"
              >
                {trade}
              </span>
            ))}
          </div>
        </Container>
      </section>

      {/* 9. Founder */}
      <section
        className="border-t border-[rgba(12,20,30,0.08)] bg-white"
        style={{ padding: "var(--section-y) 0" }}
        data-reveal
      >
        <Container>
          <FounderSection
            eyebrow={t("founder.eyebrow")}
            headline={t("founder.headline")}
            name={t("founder.name")}
            floatLabel={t("founder.floatLabel")}
            statement={t("founder.statement")}
            points={t.raw("founder.points")}
            emailLabel={cta("emailDirect")}
            email={site("founderEmail")}
            talkCta={t("founder.talkCta")}
          />
        </Container>
      </section>

      {/* 10. Pilot programme */}
      <section
        id="pilot"
        className="scroll-mt-28 bg-paper"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div
            className="grid items-start"
            style={{
              gap: "clamp(32px, 5vw, 72px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            <div data-reveal>
              <span className="inline-flex items-center gap-2 rounded-full bg-[rgba(228,118,43,0.13)] px-[13px] py-1.5 font-mono text-[10.5px] font-semibold tracking-[0.13em] text-ember-text uppercase">
                {t("pilot.badge")}
              </span>
              <h2 className="mt-[18px] font-heading text-[clamp(30px,3.6vw,46px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-navy">
                {t("pilot.headline")}
              </h2>
              <p className="text-lede mt-[18px] max-w-[34em] text-muted">
                {t("pilot.body")}
              </p>
              <p className="mt-4 max-w-[34em] text-[14px] leading-[1.55] text-muted">
                {t("pilot.landingNote")}
              </p>
            </div>

            <div
              data-reveal
              className="rounded-[18px] border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(28px,3.4vw,40px)]"
            >
              <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
                {t("pilot.pointsLabel")}
              </p>
              <ul className="mt-[22px] flex flex-col">
                {pilotPoints.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3.5 border-t border-[rgba(12,20,30,0.08)] py-[15px] text-[15.5px] leading-[1.6] text-secondary"
                  >
                    <span
                      className="mt-0.5 shrink-0 text-[14px] text-green"
                      aria-hidden
                    >
                      ✓
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-[22px] border-t border-[rgba(12,20,30,0.08)] pt-5 text-[14px] leading-[1.6] text-muted">
                {t("pilot.guarantee")}
              </p>
              <CTAButton href="/book-audit" variant="ember" className="mt-6">
                {t("pilot.cta")}
              </CTAButton>
            </div>
          </div>
        </Container>
      </section>

      {/* 11. Pricing preview */}
      <section
        className="border-t border-[rgba(12,20,30,0.08)] bg-white"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal className="max-w-[36em]">
            <SectionHeading
              align="left"
              eyebrow={t("pricingPreview.eyebrow")}
              title={t("pricingPreview.headline")}
              intro={t("pricingPreview.intro")}
            />
          </div>

          <div
            className="mt-[clamp(32px,4vw,48px)] grid"
            style={{
              gap: "clamp(14px, 2vw, 20px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
            }}
          >
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                data-reveal
                className="flex flex-col border border-[rgba(12,20,30,0.1)] bg-paper p-[clamp(22px,2.5vw,28px)] max-md:col-span-full"
              >
                <h3 className="font-heading text-[20px] font-bold tracking-[-0.03em] text-navy">
                  {tier.name}
                </h3>
                <p className="mt-3 font-heading text-[24px] font-extrabold tracking-[-0.03em] text-navy">
                  {tier.price}
                </p>
                <p className="mt-1 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                  {tier.cadence}
                </p>
                <p className="mt-4 flex-1 text-[14.5px] leading-[1.55] text-secondary">
                  {tier.idealFor}
                </p>
              </div>
            ))}
          </div>

          <div
            data-reveal
            className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3"
          >
            <CTAButton href="/pricing" variant="ember">
              {t("pricingPreview.cta")}
            </CTAButton>
            <p className="text-[14.5px] text-muted">{t("pricingPreview.note")}</p>
          </div>
        </Container>
      </section>

      {/* 12. FAQ teaser */}
      <section
        className="border-t border-[rgba(12,20,30,0.08)] bg-paper"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div
            className="grid items-start"
            style={{
              gap: "clamp(28px, 4vw, 56px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <div data-reveal className="max-w-[min(100%,28rem)]">
              <SectionHeading
                align="left"
                eyebrow={t("faqTeaser.eyebrow")}
                title={t("faqTeaser.headline")}
              />
              <CTAButton href="/faq" variant="secondary" className="mt-7">
                {t("faqTeaser.viewAll")}
              </CTAButton>
            </div>
            <div
              data-reveal
              className="min-w-0 border-t border-[rgba(12,20,30,0.12)]"
            >
              <FaqAccordion items={t.raw("faqTeaser.items")} />
            </div>
          </div>
        </Container>
      </section>

      {/* 13. Final CTA */}
      <section
        className="relative overflow-hidden bg-navy"
        style={{ padding: "var(--section-y) 0" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            WebkitMaskImage:
              "radial-gradient(90% 70% at 50% 50%, #000, transparent 75%)",
            maskImage:
              "radial-gradient(90% 70% at 50% 50%, #000, transparent 75%)",
          }}
        />
        <Container size="cta" className="relative text-center">
          <h2
            data-reveal
            className="font-heading text-[clamp(34px,4.8vw,64px)] font-extrabold leading-[1.02] tracking-[-0.042em] text-white"
          >
            {t("finalCta.headline")}
          </h2>
          <p
            data-reveal
            className="mx-auto mt-6 max-w-[36em] text-[clamp(16.5px,1.4vw,19px)] leading-[1.6] text-white/66"
          >
            {t("finalCta.body")}
          </p>
          <div data-reveal className="mt-9 flex flex-col items-center gap-3">
            <CTAButton href="/book-audit" variant="ember" size="lg">
              {t("finalCta.cta")}
            </CTAButton>
            <p className="max-w-[34em] text-[14px] leading-[1.55] text-white/50">
              {t("finalCta.underCta")}
            </p>
          </div>
          <ul
            data-reveal
            className="mt-[34px] flex flex-wrap items-center justify-center gap-x-7 gap-y-2.5"
          >
            {expect.map((item) => (
              <li
                key={item}
                className="flex items-center gap-[9px] text-[14px] text-white/55"
              >
                <span className="text-green" aria-hidden>
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
