import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { InternalHero } from "@/components/InternalHero";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { CallFlowDiagram, type FlowNode } from "@/components/CallFlowDiagram";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "aiReceptionist" });
  return buildMetadata({
    locale,
    pathname: "/ai-receptionist",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

type CapabilityGroup = { title: string; purpose: string; items: string[] };
type ListGroup = { title: string; items: string[] };

export default async function AiReceptionistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("aiReceptionist");

  const heroPoints = t.raw("heroPoints") as string[];
  const capabilityGroups = t.raw("capabilities.groups") as CapabilityGroup[];
  const emergencySteps = t.raw("emergency.steps") as string[];
  const stillIncludedGroups = t.raw("stillIncluded.groups") as ListGroup[];
  const lifecycle = t.raw("stillIncluded.lifecycle") as string[];
  const summaryFields = t.raw("summary.fields") as {
    label: string;
    value: string;
  }[];
  const summaryIncludes = t.raw("summary.includes") as string[];
  const notificationItems = t.raw("notifications.items") as string[];
  const dashboardItems = t.raw("dashboard.items") as string[];
  const dashboardStages = t.raw("dashboard.stages") as string[];
  const reportingItems = t.raw("reporting.items") as string[];
  const willNot = t.raw("guardrails.willNot") as string[];
  const escalation = t.raw("guardrails.escalation") as string[];
  const fallbackRows = t.raw("fallback.rows") as { when: string; then: string }[];
  const usageItems = t.raw("usage.items") as string[];
  const privacyItems = t.raw("privacy.items") as string[];

  return (
    <>
      <InternalHero
        eyebrow={t("eyebrow")}
        title={t("headline")}
        intro={t("intro")}
        aside={
          <div className="border border-white/12 bg-white/[0.04] p-5">
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-[rgba(255,255,255,0.6)] uppercase">
              {t("planLabel")}
            </p>
            <p className="mt-3 font-heading text-[22px] font-extrabold tracking-[-0.03em] text-white">
              {t("planName")}
            </p>
            <p className="mt-2 font-heading text-[clamp(24px,2.6vw,30px)] font-extrabold tracking-[-0.03em] text-orange">
              {t("planSetup")}
            </p>
            <p className="mt-1 text-[15px] text-white/70">{t("planCadence")}</p>
            <ul className="mt-5 flex list-none flex-col gap-2.5 border-t border-white/12 p-0 pt-5">
              {heroPoints.map((point) => (
                <li
                  key={point}
                  className="flex gap-2.5 text-[14px] leading-[1.45] text-white/72"
                >
                  <span aria-hidden className="text-orange">
                    ✓
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <CTAButton href="/book-audit" variant="ember" size="md">
                {t("ctaPrimary")}
              </CTAButton>
              <CTAButton href="/pricing" variant="ghost-ink" size="md">
                {t("ctaSecondary")}
              </CTAButton>
            </div>
            <p className="mt-4 text-[12.5px] leading-[1.5] text-white/45">
              {t("planNote")}
            </p>
          </div>
        }
      />

      {/* 1. How a call runs */}
      <section
        id="how-a-call-runs"
        className="scroll-mt-28 bg-paper pt-[clamp(48px,5vw,72px)] pb-[clamp(56px,6vw,88px)]"
      >
        <Container>
          <div data-reveal>
            <SectionHeading
              align="left"
              eyebrow={t("flow.eyebrow")}
              title={t("flow.title")}
              intro={t("flow.intro")}
              className="max-w-[46em]"
            />
          </div>
          <div data-reveal className="mt-[clamp(32px,4vw,48px)]">
            <CallFlowDiagram
              steps={t.raw("flow.steps") as FlowNode[]}
              branchLabel={t("flow.branchLabel")}
              branches={t.raw("flow.branches") as FlowNode[]}
              outcomeLabel={t("flow.outcomeLabel")}
              outcome={t.raw("flow.outcome") as FlowNode[]}
              note={t("flow.note")}
            />
          </div>
        </Container>
      </section>

      {/* 2. What it handles on the call */}
      <section
        className="border-y border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <SectionHeading
              align="left"
              eyebrow={t("capabilities.eyebrow")}
              title={t("capabilities.title")}
              intro={t("capabilities.intro")}
              className="max-w-[44em]"
            />
          </div>
          <div className="mt-[clamp(32px,4vw,48px)] grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {capabilityGroups.map((group) => (
              <div
                key={group.title}
                data-reveal
                className="flex flex-col border border-[rgb(var(--ink-rgb)/0.1)] bg-paper p-[clamp(22px,2.6vw,30px)]"
              >
                <h3 className="font-heading text-[19px] font-bold tracking-[-0.028em] text-heading">
                  {group.title}
                </h3>
                <p className="mt-2 text-[14.5px] leading-[1.55] text-ember-text">
                  {group.purpose}
                </p>
                <ul className="mt-4 flex list-none flex-col p-0">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="border-t border-[rgb(var(--ink-rgb)/0.08)] py-2.5 text-[14.5px] leading-[1.5] text-secondary"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 3. Emergencies */}
      <section className="bg-paper" style={{ padding: "var(--section-y) 0" }}>
        <Container>
          <div
            data-reveal
            className="grid items-start gap-[clamp(28px,4vw,64px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
          >
            <SectionHeading
              align="left"
              eyebrow={t("emergency.eyebrow")}
              title={t("emergency.title")}
              intro={t("emergency.intro")}
              className="max-w-none"
            />
            <div>
              <ol className="m-0 flex list-none flex-col p-0">
                {emergencySteps.map((step, i) => (
                  <li
                    key={step}
                    className="flex items-center gap-4 border-l-2 border-orange/30 py-2.5 pl-5 text-[15.5px] leading-[1.5] text-secondary first:pt-0 last:pb-0"
                  >
                    <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="mt-6 border-t border-[rgb(var(--ink-rgb)/0.1)] pt-5 text-[14px] leading-[1.6] text-muted">
                {t("emergency.note")}
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* 4. Nothing is removed */}
      <section
        className="border-y border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <SectionHeading
              align="left"
              eyebrow={t("stillIncluded.eyebrow")}
              title={t("stillIncluded.title")}
              intro={t("stillIncluded.intro")}
              className="max-w-[46em]"
            />
          </div>

          <div data-reveal className="mt-[clamp(28px,3.5vw,40px)]">
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
              {t("stillIncluded.lifecycleLabel")}
            </p>
            <ol className="mt-3 flex list-none flex-wrap items-center gap-x-1.5 gap-y-2 p-0">
              {lifecycle.map((stage, i) => (
                <li key={stage} className="flex items-center gap-1.5">
                  <span className="border border-[rgb(var(--ink-rgb)/0.12)] bg-paper px-3 py-1.5 text-[13.5px] font-medium text-heading">
                    {stage}
                  </span>
                  {i < lifecycle.length - 1 ? (
                    <span aria-hidden className="text-orange/80">
                      →
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-[clamp(28px,3.5vw,44px)] grid gap-4 md:grid-cols-3">
            {stillIncludedGroups.map((group) => (
              <div
                key={group.title}
                data-reveal
                className="border border-[rgb(var(--ink-rgb)/0.1)] bg-paper p-[clamp(22px,2.6vw,30px)]"
              >
                <h3 className="font-heading text-[18.5px] font-bold tracking-[-0.028em] text-heading">
                  {group.title}
                </h3>
                <ul className="mt-4 flex list-none flex-col p-0">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2.5 border-t border-[rgb(var(--ink-rgb)/0.08)] py-2.5 text-[14.5px] leading-[1.5] text-secondary"
                    >
                      <span aria-hidden className="text-green">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 5. After the call */}
      <section className="bg-paper" style={{ padding: "var(--section-y) 0" }}>
        <Container>
          <div
            data-reveal
            className="grid items-start gap-[clamp(28px,4vw,64px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div>
              <SectionHeading
                align="left"
                eyebrow={t("summary.eyebrow")}
                title={t("summary.title")}
                intro={t("summary.intro")}
                className="max-w-none"
              />
              <p className="mt-8 font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
                {t("summary.includesLabel")}
              </p>
              <ul className="mt-3 flex list-none flex-wrap gap-2 p-0">
                {summaryIncludes.map((item) => (
                  <li
                    key={item}
                    className="border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-3 py-1.5 text-[13.5px] text-secondary"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <CallSummaryCard
              cardLabel={t("summary.cardLabel")}
              sampleBadge={t("summary.sampleBadge")}
              fields={summaryFields}
            />
          </div>

          <div className="mt-[clamp(40px,5vw,64px)] grid gap-4 lg:grid-cols-2">
            <div
              data-reveal
              className="border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-[clamp(24px,3vw,34px)]"
            >
              <h3 className="font-heading text-[21px] font-bold tracking-[-0.03em] text-heading">
                {t("notifications.title")}
              </h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-muted">
                {t("notifications.intro")}
              </p>
              <ul className="mt-5 flex list-none flex-wrap gap-2 p-0">
                {notificationItems.map((item) => (
                  <li
                    key={item}
                    className="border border-[rgb(var(--ink-rgb)/0.12)] bg-paper px-3 py-1.5 text-[13.5px] font-medium text-heading"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              data-reveal
              className="border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-[clamp(24px,3vw,34px)]"
            >
              <h3 className="font-heading text-[21px] font-bold tracking-[-0.03em] text-heading">
                {t("dashboard.title")}
              </h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-muted">
                {t("dashboard.intro")}
              </p>
              <ul className="mt-5 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
                {dashboardItems.map((item) => (
                  <li
                    key={item}
                    className="border-t border-[rgb(var(--ink-rgb)/0.08)] py-2 text-[14px] leading-[1.45] text-secondary"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
                {t("dashboard.stagesLabel")}
              </p>
              <ol className="mt-3 flex list-none flex-wrap items-center gap-x-1.5 gap-y-2 p-0">
                {dashboardStages.map((stage, i) => (
                  <li key={stage} className="flex items-center gap-1.5">
                    <span className="border border-[rgb(var(--ink-rgb)/0.12)] bg-paper px-2.5 py-1 text-[13px] font-medium text-heading">
                      {stage}
                    </span>
                    {i < dashboardStages.length - 1 ? (
                      <span aria-hidden className="text-orange/80">
                        →
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Container>
      </section>

      {/* 6. Reporting */}
      <section
        className="border-y border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div
            data-reveal
            className="grid items-start gap-[clamp(24px,4vw,56px)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
          >
            <div>
              <h2 className="text-section m-0 text-heading">
                {t("reporting.title")}
              </h2>
              <p className="mt-4 text-[16px] leading-[1.65] text-muted">
                {t("reporting.intro")}
              </p>
              <p className="mt-5 text-[14px] leading-[1.6] text-muted">
                {t("reporting.note")}
              </p>
            </div>
            <ul className="m-0 grid list-none gap-x-8 p-0 sm:grid-cols-2">
              {reportingItems.map((item) => (
                <li
                  key={item}
                  className="border-t border-[rgb(var(--ink-rgb)/0.1)] py-3 text-[14.5px] leading-[1.45] text-secondary"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* 7. Guardrails and fallbacks */}
      <section className="bg-paper" style={{ padding: "var(--section-y) 0" }}>
        <Container>
          <div data-reveal>
            <SectionHeading
              align="left"
              eyebrow={t("guardrails.eyebrow")}
              title={t("guardrails.title")}
              intro={t("guardrails.intro")}
              className="max-w-[44em]"
            />
          </div>

          <div className="mt-[clamp(28px,3.5vw,44px)] grid gap-4 lg:grid-cols-2">
            <div
              data-reveal
              className="border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-[clamp(24px,3vw,34px)]"
            >
              <p className="font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
                {t("guardrails.willNotLabel")}
              </p>
              <ul className="mt-4 flex list-none flex-col p-0">
                {willNot.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 border-t border-[rgb(var(--ink-rgb)/0.08)] py-2.5 text-[14.5px] leading-[1.5] text-secondary"
                  >
                    <span aria-hidden className="text-[#C4564A]">
                      ✕
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              data-reveal
              className="flex flex-col bg-navy p-[clamp(24px,3vw,34px)] text-white"
            >
              <p className="font-mono text-[10.5px] tracking-[0.12em] text-[rgba(255,255,255,0.6)] uppercase">
                {t("guardrails.escalationLabel")}
              </p>
              <ul className="mt-4 flex list-none flex-col p-0">
                {escalation.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 border-t border-white/10 py-3 text-[15px] leading-[1.55] text-white/80"
                  >
                    <span aria-hidden className="text-orange">
                      →
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-auto pt-6 text-[13.5px] leading-[1.6] text-white/55">
                {t("guardrails.note")}
              </p>
            </div>
          </div>

          <div data-reveal className="mt-[clamp(40px,5vw,64px)]">
            <h3 className="font-heading text-[clamp(22px,2.4vw,28px)] font-extrabold tracking-[-0.035em] text-heading">
              {t("fallback.title")}
            </h3>
            <p className="mt-3 max-w-[46em] text-[15.5px] leading-[1.6] text-muted">
              {t("fallback.intro")}
            </p>
            <table className="mt-7 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[rgb(var(--ink-rgb)/0.16)]">
                  <th
                    scope="col"
                    className="w-[44%] py-3 pr-4 font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted uppercase"
                  >
                    {t("fallback.whenLabel")}
                  </th>
                  <th
                    scope="col"
                    className="py-3 font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted uppercase"
                  >
                    {t("fallback.thenLabel")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {fallbackRows.map((row) => (
                  <tr
                    key={row.when}
                    className="border-b border-[rgb(var(--ink-rgb)/0.08)]"
                  >
                    <th
                      scope="row"
                      className="py-3.5 pr-4 align-top text-[14px] leading-[1.45] font-semibold text-heading sm:text-[15px]"
                    >
                      {row.when}
                    </th>
                    <td className="py-3.5 align-top text-[14px] leading-[1.5] text-secondary sm:text-[15px]">
                      {row.then}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      {/* 8. Usage and privacy */}
      <section
        className="border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div className="grid gap-4 lg:grid-cols-2">
            <div
              data-reveal
              className="border border-[rgb(var(--ink-rgb)/0.1)] bg-paper p-[clamp(24px,3vw,34px)]"
            >
              <h2 className="m-0 font-heading text-[clamp(21px,2.2vw,26px)] font-extrabold tracking-[-0.032em] text-heading">
                {t("usage.title")}
              </h2>
              <p className="mt-3 text-[15.5px] leading-[1.6] text-muted">
                {t("usage.body")}
              </p>
              <ul className="mt-5 flex list-none flex-col p-0">
                {usageItems.map((item) => (
                  <li
                    key={item}
                    className="border-t border-[rgb(var(--ink-rgb)/0.08)] py-2.5 text-[14.5px] leading-[1.5] text-secondary"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              data-reveal
              className="border border-[rgb(var(--ink-rgb)/0.1)] bg-paper p-[clamp(24px,3vw,34px)]"
            >
              <h2 className="m-0 font-heading text-[clamp(21px,2.2vw,26px)] font-extrabold tracking-[-0.032em] text-heading">
                {t("privacy.title")}
              </h2>
              <p className="mt-3 text-[15.5px] leading-[1.6] text-muted">
                {t("privacy.body")}
              </p>
              <ul className="mt-5 flex list-none flex-col p-0">
                {privacyItems.map((item) => (
                  <li
                    key={item}
                    className="border-t border-[rgb(var(--ink-rgb)/0.08)] py-2.5 text-[14.5px] leading-[1.5] text-secondary"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[13.5px] leading-[1.6] text-muted">
                {t("privacy.note")}
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* 9. Final CTA */}
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
            className="font-heading text-[clamp(30px,4.2vw,54px)] font-extrabold leading-[1.04] tracking-[-0.042em] text-white"
          >
            {t("finalCta.title")}
          </h2>
          <p
            data-reveal
            className="mx-auto mt-6 max-w-[36em] text-[clamp(16px,1.4vw,18.5px)] leading-[1.6] text-white/66"
          >
            {t("finalCta.body")}
          </p>
          <div
            data-reveal
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <CTAButton href="/book-audit" variant="ember" size="lg">
              {t("finalCta.primary")}
            </CTAButton>
            <CTAButton href="/pricing" variant="ghost-ink" size="lg">
              {t("finalCta.secondary")}
            </CTAButton>
          </div>
          <p
            data-reveal
            className="mx-auto mt-6 max-w-[34em] text-[14px] leading-[1.55] text-white/50"
          >
            {t("finalCta.note")}
          </p>
        </Container>
      </section>
    </>
  );
}
