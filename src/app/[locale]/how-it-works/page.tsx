import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { InternalHero } from "@/components/InternalHero";
import { CTAButton } from "@/components/CTAButton";
import {
  PlanWalkthrough,
  type PlanWalkthroughCopy,
} from "@/components/PlanWalkthrough";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorks" });
  return buildMetadata({
    locale,
    pathname: "/how-it-works",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("howItWorks");
  const plans = await getTranslations("plans");

  const stages = t.raw("stages") as { title: string; items: string[] }[];
  const sequence = t.raw("sequence") as { day: string; action: string }[];
  const heroSteps = t.raw("heroSteps") as string[];

  const walkthroughScenes = Object.fromEntries(
    (
      Object.entries(plans.raw("capabilities") as Record<
        string,
        { demoTitle: string; demoBody: string }
      >) as [string, { demoTitle: string; demoBody: string }][]
    ).map(([id, cap]) => [id, { title: cap.demoTitle, body: cap.demoBody }]),
  );

  const walkthroughCopy: PlanWalkthroughCopy = {
    eyebrow: plans("walkthrough.eyebrow"),
    title: plans("walkthrough.title"),
    intro: plans("walkthrough.intro"),
    illustrativeLabel: plans("walkthrough.illustrativeLabel"),
    selectLabel: plans("walkthrough.selectLabel"),
    next: plans("walkthrough.next"),
    previous: plans("walkthrough.previous"),
    // Plain template — PlanWalkthrough fills {current}/{total}. Do not use
    // plans("…"): next-intl would require those values at call time.
    stepOf: plans.raw("walkthrough.stepOf") as string,
    planKinds: {
      starter: plans("kind.starter"),
      growth: plans("kind.growth"),
      receptionist: plans("kind.receptionist"),
    },
    planNames: {
      starter: plans("names.starter"),
      growth: plans("names.growth"),
      receptionist: plans("names.receptionist"),
    },
    scenes: walkthroughScenes,
  };

  return (
    <>
      <InternalHero
        eyebrow={t("eyebrow")}
        title={t("headline")}
        intro={t("intro")}
        aside={
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {heroSteps.map((step, i) => (
              <div
                key={step}
                className="border border-white/12 bg-white/[0.04] px-3 py-3"
              >
                <p className="font-mono text-[10px] text-orange">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="mt-1 text-[13px] font-medium leading-snug text-white/85">
                  {step}
                </p>
              </div>
            ))}
          </div>
        }
      />

      <section className="border-b border-[rgb(var(--ink-rgb)/0.08)] bg-surface py-[clamp(48px,6vw,80px)]">
        <Container size="how">
          <div data-reveal>
            <PlanWalkthrough copy={walkthroughCopy} initialPlan="starter" />
          </div>
        </Container>
      </section>

      <section className="bg-paper pt-[clamp(36px,4vw,52px)] pb-[clamp(64px,7vw,100px)]">
        <Container size="how">
          {stages.map((stage, i) => (
            <div
              key={stage.title}
              data-reveal
              className="border-t border-[rgb(var(--ink-rgb)/0.12)] py-[clamp(24px,3vw,36px)]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "clamp(16px, 3vw, 40px)",
              }}
            >
              <div className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-navy font-mono text-[12px] font-semibold text-orange">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="mt-1.5 font-heading text-[clamp(20px,2.2vw,26px)] font-bold leading-[1.15] tracking-[-0.03em] text-heading">
                  {stage.title}
                </h2>
              </div>
              <ul className="m-0 flex list-none flex-wrap content-start gap-2 p-0">
                {stage.items.map((item) => (
                  <li
                    key={item}
                    className="border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-3.5 py-2 text-[14px] text-secondary"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div
            data-reveal
            className="mt-[clamp(28px,4vw,44px)] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-[clamp(24px,3vw,36px)]"
          >
            <p className="text-[13px] font-medium text-ember-text">
              {t("sequenceTitle")}
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sequence.map((step) => (
                <div
                  key={step.day}
                  className="border border-[rgb(var(--ink-rgb)/0.1)] bg-paper px-4 py-5"
                >
                  <p className="text-[12px] font-semibold text-ember-text">
                    {step.day}
                  </p>
                  <p className="mt-2 text-[15px] leading-[1.5] text-text">
                    {step.action}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[14.5px] leading-[1.6] text-muted">
              {t("sequenceNote")}
            </p>
          </div>

          <div data-reveal className="mt-8 text-center">
            <CTAButton href="/book-audit" variant="ink" size="lg">
              {t("cta")}
            </CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
