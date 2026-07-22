import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { Card } from "@/components/Card";
import { NumberedStep } from "@/components/NumberedStep";
import { WorkflowDiagram } from "@/components/WorkflowDiagram";
import { HeroMockup } from "@/components/HeroMockup";
import { ScenarioTimeline } from "@/components/ScenarioTimeline";
import { DashboardPreview } from "@/components/DashboardPreview";
import { ComparisonPanel } from "@/components/ComparisonPanel";
import { FaqAccordion } from "@/components/FaqAccordion";
import { FounderSection } from "@/components/FounderSection";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/StaggerGroup";
import {
  PhoneMissedIcon,
  QuoteIcon,
  FollowUpIcon,
  TechnicianIcon,
  CheckIcon,
  MessageIcon,
  SignatureIcon,
} from "@/components/icons";
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
    title: (t.raw("hero.headlineLines") as string[]).join(" "),
    description: t("hero.subheadline"),
  });
}

const TRUST_CHIP_ICONS = [MessageIcon, SignatureIcon, CheckIcon];

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

  return (
    <>
      {/* 1. Hero */}
      <section className="relative overflow-hidden bg-white py-16 sm:py-24">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0" />
        <Container className="relative grid gap-12 lg:grid-cols-[5fr_7fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-navy/15 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-navy">
              <span className="h-1.5 w-1.5 rounded-full bg-orange" />
              {t("hero.eyebrow")}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-navy sm:text-5xl lg:text-[3.4rem]">
              {t.raw("hero.headlineLines").map((line: string, i: number) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-text/70">
              {t("hero.subheadline")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CTAButton href="/book-audit" size="lg">
                {cta("primary")}
              </CTAButton>
              <a
                href="#product-demo"
                className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-navy/15 bg-white px-8 py-4 text-lg font-semibold text-navy transition-colors duration-200 hover:border-blue hover:text-blue focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {cta("watchDemo")}
              </a>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-text/50">
              {t("hero.reassurance")}
            </p>
            <p className="mt-4 text-sm font-medium text-text/70">
              {t("hero.proofLine")}
            </p>
            <ul className="mt-6 flex flex-col gap-3 border-t border-navy/10 pt-6 sm:flex-row sm:flex-wrap sm:gap-6">
              {t.raw("hero.trustChips").map((chip: string, i: number) => {
                const Icon = TRUST_CHIP_ICONS[i] ?? CheckIcon;
                return (
                  <li key={chip} className="flex items-center gap-2 text-sm text-text/70">
                    <Icon className="h-4 w-4 shrink-0 text-green" />
                    {chip}
                  </li>
                );
              })}
            </ul>
          </div>
          <HeroMockup
            illustrativeLabel={t("hero.mockup.illustrativeLabel")}
            missedCallLabel={t("hero.mockup.missedCallLabel")}
            missedCallTime={t("hero.mockup.missedCallTime")}
            chatTime={t("hero.mockup.chatTime")}
            systemMessage={t("hero.mockup.systemMessage")}
            customerReply={t("hero.mockup.customerReply")}
            technicianAlert={t("hero.mockup.technicianAlert")}
            technicianAlertTime={t("hero.mockup.technicianAlertTime")}
            technicianAcceptedLabel={t("hero.mockup.technicianAcceptedLabel")}
            dashboardResult={t("hero.mockup.dashboardResult")}
            dashboardResultTime={t("hero.mockup.dashboardResultTime")}
            dashboardMetricValue={t("hero.mockup.dashboardMetricValue")}
            dashboardMetricLabel={t("hero.mockup.dashboardMetricLabel")}
          />
        </Container>
      </section>

      {/* 2. Product demonstration */}
      <Reveal as="section" id="product-demo" className="scroll-mt-20 bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("scenario.headline")} intro={t("scenario.intro")} />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-orange-dark">
            {t("scenario.exampleLabel")}
          </p>
          <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
            <ScenarioTimeline
              label={t("scenario.timelineLabel")}
              steps={t.raw("scenario.steps")}
            />
            <div className="lg:pt-2">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-blue">
                {t("scenario.secondFlowLabel")}
              </p>
              <WorkflowDiagram caption={t("scenario.secondFlowCaption")} />
            </div>
          </div>
        </Container>
      </Reveal>

      {/* 3. Revenue leaks */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
          <div>
            <SectionHeading align="left" title={t("leaks.headline")} intro={t("leaks.intro")} />
            <CTAButton href="/book-audit" variant="secondary" className="mt-8">
              {cta("primary")}
            </CTAButton>
          </div>
          <StaggerGroup className="divide-y divide-navy/10 border-y border-navy/10">
            {t.raw("leaks.cards").map((card: { title: string; body: string }, i: number) => {
              const Icon = [PhoneMissedIcon, QuoteIcon, FollowUpIcon][i] ?? FollowUpIcon;
              return (
                <StaggerItem key={card.title}>
                  <div className="flex items-start gap-5 py-6 first:pt-0 last:pb-0">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/5 text-navy">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-navy">{card.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-text/70">{card.body}</p>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </Container>
      </Reveal>

      {/* 4. One system, then missed-call recovery and quote follow-up */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <SectionHeading title={t("system.headline")} />
            <CTAButton href="/how-it-works" variant="ghost">
              {cta("seeWorkflow")}
            </CTAButton>
          </div>
          <StaggerGroup className="mt-8 flex flex-wrap gap-3">
            {t.raw("system.steps").map((step: { title: string }, i: number) => (
              <StaggerItem key={step.title}>
                <span className="flex items-center gap-2 rounded-full border border-navy/10 bg-bg px-4 py-2 text-sm font-medium text-navy">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                  {step.title}
                </span>
              </StaggerItem>
            ))}
          </StaggerGroup>

          <div className="mt-14 grid gap-10 border-t border-navy/10 pt-14 lg:grid-cols-2 lg:gap-14">
            <div>
              <SectionHeading align="left" title={t("missedCall.headline")} />
              <ul className="mt-6 space-y-3">
                {t.raw("missedCall.items").map((item: string) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-text/70">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-xl border border-navy/10 bg-white p-6 shadow-card">
                <div className="flex items-center gap-3 text-navy">
                  <TechnicianIcon className="h-6 w-6" />
                  <span className="text-sm font-semibold uppercase tracking-wide">
                    {t("missedCall.badge")}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-text/70">
                  {t("missedCall.note")}
                </p>
              </div>
              <CTAButton href="/services" variant="secondary" className="mt-8">
                {cta("viewMissedCall")}
              </CTAButton>
            </div>
            <div className="border-t border-navy/10 pt-10 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-14">
              <SectionHeading align="left" title={t("quoteFollowUp.headline")} />
              <ul className="mt-6 space-y-3">
                {t.raw("quoteFollowUp.items").map((item: string) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-text/70">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-xl border border-navy/10 bg-bg p-6">
                <ol className="space-y-4">
                  {t.raw("quoteFollowUp.sequence").map((step: { day: string; action: string }) => (
                    <li key={step.day} className="flex gap-4">
                      <span className="w-16 shrink-0 text-sm font-semibold text-blue">
                        {step.day}
                      </span>
                      <span className="text-sm text-text/70">{step.action}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <CTAButton href="/services" variant="secondary" className="mt-8">
                {cta("viewQuoteFollowUp")}
              </CTAButton>
            </div>
          </div>
        </Container>
      </Reveal>

      {/* 5. Manual vs automated comparison */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("comparison.headline")} />
          <div className="mt-12">
            <ComparisonPanel
              manualLabel={t("comparison.manualLabel")}
              systemLabel={t("comparison.systemLabel")}
              rows={t.raw("comparison.rows")}
            />
          </div>
        </Container>
      </Reveal>

      {/* 6. Dashboard */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading align="left" title={t("dashboard.headline")} />
            <p className="mt-4 text-sm text-text/70">{t("dashboard.note")}</p>
            <CTAButton href="/book-audit" variant="secondary" className="mt-8">
              {cta("primary")}
            </CTAButton>
          </div>
          <DashboardPreview
            metrics={t.raw("dashboard.metrics")}
            badge={t("dashboard.badge")}
            liveLabel={t("dashboard.live")}
            sampleDataLabel={t("dashboard.sampleDataLabel")}
          />
        </Container>
      </Reveal>

      {/* 7. Industries */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("industries.headline")} />
          <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-navy/50">
            {t("industries.priorityLabel")}
          </p>
          <StaggerGroup className="mt-4 grid gap-6 sm:grid-cols-3">
            {t.raw("industries.priority").map((card: { name: string; pain: string }) => (
              <StaggerItem key={card.name}>
                <Card title={card.name}>{card.pain}</Card>
              </StaggerItem>
            ))}
          </StaggerGroup>
          <p className="mt-10 text-xs font-semibold uppercase tracking-wide text-navy/50">
            {t("industries.supportingLabel")}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {t.raw("industries.supporting").map((trade: string) => (
              <li
                key={trade}
                className="rounded-full border border-navy/10 bg-bg px-4 py-1.5 text-sm text-text/70"
              >
                {trade}
              </li>
            ))}
          </ul>
          <div className="mt-10 text-center">
            <CTAButton href="/industries" variant="secondary">
              {cta("viewIndustries")}
            </CTAButton>
          </div>
        </Container>
      </Reveal>

      {/* 8. Implementation */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("implementation.headline")} />
          <div className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {t.raw("implementation.steps").map((step: { title: string; body: string }, i: number) => (
              <NumberedStep key={step.title} index={i + 1} title={step.title}>
                {step.body}
              </NumberedStep>
            ))}
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
          </div>
        </Container>
      </Reveal>

      {/* 9. Trust: tested with your team */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("trust.headline")} intro={t("trust.intro")} />
          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {t.raw("trust.verifiedItems").map((item: string) => (
              <li key={item} className="flex items-start gap-3 text-base leading-relaxed text-text/80">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-green" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-14 border-t border-navy/10 pt-10">
            <h3 className="text-lg font-semibold text-navy">{t("trust.controlHeadline")}</h3>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {t.raw("trust.points").map((point: string) => (
                <li key={point} className="flex items-start gap-3 text-base leading-relaxed text-text/80">
                  <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-green" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-8 text-sm text-text/60">{t("trust.guaranteeNote")}</p>
        </Container>
      </Reveal>

      {/* 10. Founder */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container>
          <FounderSection
            headline={t("founder.headline")}
            name={t("founder.name")}
            role={t("founder.role")}
            statement={t("founder.statement")}
            bio={t("founder.bio")}
            points={t.raw("founder.points")}
            emailLabel={t("founder.emailLabel")}
            email={site("founderEmail")}
            talkCta={t("founder.talkCta")}
          />
        </Container>
      </Reveal>

      {/* 11. Pilot program */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
          <div>
            <SectionHeading align="left" title={t("pilot.headline")} />
          </div>
          <div>
            <p className="text-base leading-relaxed text-text/70">{t("pilot.body")}</p>
            <ul className="mt-6 space-y-3">
              {t.raw("pilot.points").map((point: string) => (
                <li key={point} className="flex items-start gap-3 text-sm text-text/70">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Reveal>

      {/* 12. FAQ teaser */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
          <div>
            <SectionHeading align="left" title={t("faqTeaser.headline")} />
            <CTAButton href="/faq" variant="secondary" className="mt-8">
              {t("faqTeaser.viewAll")}
            </CTAButton>
          </div>
          <FaqAccordion items={t.raw("faqTeaser.items")} />
        </Container>
      </Reveal>

      {/* 13. Final CTA */}
      <Reveal as="section" className="relative overflow-hidden bg-navy py-16 sm:py-24">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-20 invert" />
        <Container className="relative text-center">
          <h2 className="mx-auto max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl">
            {t("finalCta.headline")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/70">
            {t("finalCta.body")}
          </p>
          <ul className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-white/60">
            {t.raw("finalCta.whatToExpect").map((item: string) => (
              <li key={item} className="flex items-center gap-2">
                <CheckIcon className="h-4 w-4 shrink-0 text-green" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <CTAButton href="/book-audit" size="lg">
              {cta("primary")}
            </CTAButton>
          </div>
        </Container>
      </Reveal>
    </>
  );
}
