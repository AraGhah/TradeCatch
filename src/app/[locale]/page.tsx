import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { Card } from "@/components/Card";
import { NumberedStep } from "@/components/NumberedStep";
import { WorkflowDiagram } from "@/components/WorkflowDiagram";
import { DashboardPreview } from "@/components/DashboardPreview";
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
    title: t("hero.headline"),
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

  return (
    <>
      {/* 1. Hero */}
      <section className="relative overflow-hidden bg-white py-16 sm:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue/5 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-40 h-72 w-72 rounded-full bg-orange/10 blur-3xl"
        />
        <Container className="relative grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="inline-flex items-center rounded-full border border-blue/20 bg-blue/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue">
              {t("hero.eyebrow")}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] text-navy sm:text-5xl">
              {t("hero.headline")}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-text/70">
              {t("hero.subheadline")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CTAButton href="/book-audit" size="lg">
                {cta("primary")}
              </CTAButton>
              <CTAButton href="/how-it-works" variant="secondary" size="lg">
                {cta("watchDemo")}
              </CTAButton>
            </div>
            <p className="mt-6 text-sm font-medium text-text/70">
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
          <WorkflowDiagram caption={t("hero.workflowCaption")} />
        </Container>
      </section>

      {/* 2. Revenue leaks */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("leaks.headline")} />
          <StaggerGroup className="mt-12 grid gap-6 md:grid-cols-3">
            {t.raw("leaks.cards").map((card: { title: string; body: string }, i: number) => (
              <StaggerItem key={card.title}>
                <Card
                  title={card.title}
                  icon={
                    i === 0 ? (
                      <PhoneMissedIcon className="h-5 w-5" />
                    ) : i === 1 ? (
                      <QuoteIcon className="h-5 w-5" />
                    ) : (
                      <FollowUpIcon className="h-5 w-5" />
                    )
                  }
                >
                  {card.body}
                </Card>
              </StaggerItem>
            ))}
          </StaggerGroup>
          <div className="mt-10 text-center">
            <CTAButton href="/book-audit" variant="secondary">
              {cta("findLeaks")}
            </CTAButton>
          </div>
        </Container>
      </Reveal>

      {/* 3. Complete system */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("system.headline")} />
          <div className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {t.raw("system.steps").map((step: { title: string; body: string }, i: number) => (
              <NumberedStep key={step.title} index={i + 1} title={step.title}>
                {step.body}
              </NumberedStep>
            ))}
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/how-it-works" variant="secondary">
              {cta("seeWorkflow")}
            </CTAButton>
          </div>
        </Container>
      </Reveal>

      {/* 4. Missed-call recovery */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
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
            <CTAButton href="/services" variant="secondary" className="mt-8">
              {cta("viewMissedCall")}
            </CTAButton>
          </div>
          <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
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
        </Container>
      </Reveal>

      {/* 5. Quote follow-up */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHeading align="left" title={t("quoteFollowUp.headline")} />
            <ul className="mt-6 space-y-3">
              {t.raw("quoteFollowUp.items").map((item: string) => (
                <li key={item} className="flex items-start gap-3 text-sm text-text/70">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                  {item}
                </li>
              ))}
            </ul>
            <CTAButton href="/services" variant="secondary" className="mt-8">
              {cta("viewQuoteFollowUp")}
            </CTAButton>
          </div>
          <div className="rounded-xl border border-navy/10 bg-bg p-6">
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
        </Container>
      </Reveal>

      {/* 6. Dashboard */}
      <Reveal as="section" className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading align="left" title={t("dashboard.headline")} />
            <p className="mt-4 text-sm text-text/70">{t("dashboard.note")}</p>
            <CTAButton href="/book-audit" variant="secondary" className="mt-8">
              {cta("requestDashboard")}
            </CTAButton>
          </div>
          <DashboardPreview
            metrics={t.raw("dashboard.metrics")}
            badge={t("dashboard.badge")}
            liveLabel={t("dashboard.live")}
          />
        </Container>
      </Reveal>

      {/* 7. Industries */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("industries.headline")} />
          <StaggerGroup className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.raw("industries.cards").map((card: { name: string; pain: string }) => (
              <StaggerItem key={card.name}>
                <Card title={card.name}>{card.pain}</Card>
              </StaggerItem>
            ))}
          </StaggerGroup>
          <div className="mt-10 text-center">
            <CTAButton href="/industries" variant="secondary">
              {cta("viewIndustries")}
            </CTAButton>
          </div>
        </Container>
      </Reveal>

      {/* 8. Implementation */}
      <Reveal as="section" className="py-16 sm:py-24">
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
            <CTAButton href="/book-audit">{cta("bookRevenueAudit")}</CTAButton>
          </div>
        </Container>
      </Reveal>

      {/* 9. Trust */}
      <Reveal as="section" className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("trust.headline")} />
          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <ul className="grid gap-3 sm:grid-cols-2">
              {t.raw("trust.points").map((point: string) => (
                <li key={point} className="flex items-start gap-3 text-sm text-text/70">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="rounded-xl border border-navy/10 bg-navy p-8 text-white">
              <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
                {t("trust.guaranteeTitle")}
              </p>
              <p className="mt-3 text-lg leading-relaxed">{t("trust.guaranteeBody")}</p>
            </div>
          </div>
        </Container>
      </Reveal>

      {/* 10. Final CTA */}
      <Reveal as="section" className="bg-navy py-16 sm:py-24">
        <Container className="text-center">
          <h2 className="mx-auto max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl">
            {t("finalCta.headline")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/70">
            {t("finalCta.body")}
          </p>
          <div className="mt-8">
            <CTAButton href="/book-audit" size="lg">
              {cta("bookFinal")}
            </CTAButton>
          </div>
        </Container>
      </Reveal>
    </>
  );
}
