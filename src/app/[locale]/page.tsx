import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { Card } from "@/components/Card";
import { NumberedStep } from "@/components/NumberedStep";
import { WorkflowDiagram } from "@/components/WorkflowDiagram";
import { DashboardPreview } from "@/components/DashboardPreview";
import {
  PhoneMissedIcon,
  QuoteIcon,
  FollowUpIcon,
  TechnicianIcon,
  CheckIcon,
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
      <section className="bg-white py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="text-4xl font-bold leading-tight text-navy sm:text-5xl">
              {t("hero.headline")}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-text/80">
              {t("hero.subheadline")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
              <CTAButton href="/how-it-works" variant="secondary">
                {cta("watchDemo")}
              </CTAButton>
            </div>
            <p className="mt-6 text-sm text-text/60">{t("hero.proofLine")}</p>
          </div>
          <WorkflowDiagram caption={t("hero.workflowCaption")} />
        </Container>
      </section>

      {/* 2. Revenue leaks */}
      <section className="py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("leaks.headline")} />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {t.raw("leaks.cards").map((card: { title: string; body: string }, i: number) => (
              <Card
                key={card.title}
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
            ))}
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/book-audit" variant="secondary">
              {cta("findLeaks")}
            </CTAButton>
          </div>
        </Container>
      </section>

      {/* 3. Complete system */}
      <section className="bg-white py-16 sm:py-24">
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
      </section>

      {/* 4. Missed-call recovery */}
      <section className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHeading align="left" title={t("missedCall.headline")} />
            <ul className="mt-6 space-y-3">
              {t.raw("missedCall.items").map((item: string) => (
                <li key={item} className="flex items-start gap-3 text-sm text-text/80">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                  {item}
                </li>
              ))}
            </ul>
            <CTAButton href="/services" variant="secondary" className="mt-8">
              {cta("viewMissedCall")}
            </CTAButton>
          </div>
          <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-navy">
              <TechnicianIcon className="h-6 w-6" />
              <span className="text-sm font-semibold uppercase tracking-wide">
                Human oversight
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-text/80">
              {t("missedCall.note")}
            </p>
          </div>
        </Container>
      </section>

      {/* 5. Quote follow-up */}
      <section className="bg-white py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHeading align="left" title={t("quoteFollowUp.headline")} />
            <ul className="mt-6 space-y-3">
              {t.raw("quoteFollowUp.items").map((item: string) => (
                <li key={item} className="flex items-start gap-3 text-sm text-text/80">
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
                  <span className="text-sm text-text/80">{step.action}</span>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      {/* 6. Dashboard */}
      <section className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading align="left" title={t("dashboard.headline")} />
            <p className="mt-4 text-sm text-text/70">{t("dashboard.note")}</p>
            <CTAButton href="/book-audit" variant="secondary" className="mt-8">
              {cta("requestDashboard")}
            </CTAButton>
          </div>
          <DashboardPreview metrics={t.raw("dashboard.metrics")} />
        </Container>
      </section>

      {/* 7. Industries */}
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("industries.headline")} />
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.raw("industries.cards").map((card: { name: string; pain: string }) => (
              <Card key={card.name} title={card.name}>
                {card.pain}
              </Card>
            ))}
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/industries" variant="secondary">
              {cta("viewIndustries")}
            </CTAButton>
          </div>
        </Container>
      </section>

      {/* 8. Implementation */}
      <section className="py-16 sm:py-24">
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
      </section>

      {/* 9. Trust */}
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("trust.headline")} />
          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <ul className="space-y-3">
              {t.raw("trust.points").map((point: string) => (
                <li key={point} className="flex items-start gap-3 text-sm text-text/80">
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
      </section>

      {/* 10. Final CTA */}
      <section className="py-16 sm:py-24">
        <Container className="text-center">
          <h2 className="mx-auto max-w-3xl text-3xl font-bold leading-tight text-navy sm:text-4xl">
            {t("finalCta.headline")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text/80">
            {t("finalCta.body")}
          </p>
          <div className="mt-8">
            <CTAButton href="/book-audit">{cta("bookFinal")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
