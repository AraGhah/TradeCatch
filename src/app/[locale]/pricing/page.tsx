import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { StickyAuditCta } from "@/components/StickyAuditCta";
import {
  PricingExperience,
  type PricingTier,
} from "@/components/PricingExperience";
import {
  PlanComparison,
  type PlanComparisonData,
} from "@/components/PlanComparison";
import {
  PlanBreakEven,
  type PlanBreakEvenCopy,
} from "@/components/PlanBreakEven";
import {
  PlanWalkthrough,
  type PlanWalkthroughCopy,
} from "@/components/PlanWalkthrough";
import {
  WebsiteBuilderAddOn,
  type WebsiteBuilderAddOnCopy,
} from "@/components/WebsiteBuilderAddOn";
import {
  ReferralProgramTeaser,
  type ReferralProgramTeaserCopy,
} from "@/components/ReferralProgramTeaser";
import { localizedAnchor } from "@/lib/anchors";
import { buildMetadata } from "@/lib/seo";
import type { PlanId } from "@/product/saas/plan-catalog";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return buildMetadata({
    locale,
    pathname: "/pricing",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const plans = await getTranslations("plans");
  const cta = await getTranslations("cta");

  // Hash links need the visitor's localized path (see localizedAnchor).
  const tiers = (t.raw("tiers") as PricingTier[]).map((tier) =>
    tier.secondaryCtaHref?.includes("#")
      ? {
          ...tier,
          secondaryCtaHref: localizedAnchor(locale, tier.secondaryCtaHref),
        }
      : tier,
  );
  const principles = t.raw("principles") as string[];
  const details = t.raw("details") as { title: string; body: string }[];
  const comparison = t.raw("comparison") as PlanComparisonData;
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: details.map((detail) => ({
      "@type": "Question",
      name: detail.title,
      acceptedAnswer: { "@type": "Answer", text: detail.body },
    })),
  };

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

  const addOnCopy: WebsiteBuilderAddOnCopy = {
    eyebrow: plans("addOns.websiteBuilder.eyebrow"),
    title: plans("addOns.websiteBuilder.title"),
    intro: plans("addOns.websiteBuilder.intro"),
    priceNote: plans("addOns.websiteBuilder.priceNote"),
    schedulePending: plans("addOns.websiteBuilder.schedulePending"),
    availableOn: plans("addOns.websiteBuilder.availableOn"),
    neverIncluded: plans("addOns.websiteBuilder.neverIncluded"),
    cta: plans("addOns.websiteBuilder.cta"),
  };

  const referralT = await getTranslations("referrals.public");
  const referralCopy: ReferralProgramTeaserCopy = {
    eyebrow: referralT("eyebrow"),
    title: referralT("headline"),
    intro: referralT("intro"),
    youEarn: referralT("youEarn"),
    giftCard: referralT("giftCard"),
    cta: plans("referralTeaser.cta"),
    planNames: {
      starter: plans("names.starter"),
      growth: plans("names.growth"),
      receptionist: plans("names.receptionist"),
    },
  };

  const planIds: PlanId[] = ["starter", "growth", "receptionist"];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <section className="relative overflow-hidden bg-navy pt-[clamp(80px,9vw,110px)] pb-[clamp(88px,10vw,120px)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(70% 70% at 30% 40%, #000 10%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-10 h-[420px] w-[420px] rounded-full opacity-30"
          style={{
            background:
              "radial-gradient(circle, rgba(228,118,43,0.35) 0%, transparent 68%)",
          }}
        />

        <Container className="relative">
          <div className="grid items-end gap-x-16 gap-y-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-[13px] font-medium text-orange">{t("eyebrow")}</p>
              <h1
                className="mt-4 max-w-[14em] font-heading font-extrabold text-white"
                style={{
                  fontSize: "clamp(36px, 5vw, 58px)",
                  lineHeight: 0.98,
                  letterSpacing: "-0.045em",
                }}
              >
                {t("headline")}
              </h1>
              <p className="mt-5 max-w-[34em] text-[clamp(16px,1.35vw,18px)] leading-[1.6] text-white/68">
                {t("intro")}
              </p>
            </div>

            <div className="border-l border-white/15 pl-0 lg:pl-10">
              <ul className="m-0 flex list-none flex-col p-0">
                {principles.map((item) => (
                  <li
                    key={item}
                    className="border-t border-white/12 py-4 text-[16px] leading-[1.45] font-medium tracking-[-0.015em] text-white/82 first:border-t-0 first:pt-0"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-[13px] leading-[1.5] text-white/45">
                {t("reassurance")}
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-paper pb-[clamp(40px,5vw,64px)]">
        <Container>
          <PricingExperience
            tiers={tiers}
            labels={{
              cta: t("cta"),
              setupLabel: t("setupLabel"),
              onceLabel: t("onceLabel"),
              monthlyEyebrow: t("monthlyEyebrow"),
              customTitle: t("customTitle"),
              customBody: t("customBody"),
              customCta: t("customCta"),
              includesTitle: t("includesTitle"),
              includesItems: t.raw("includesItems") as string[],
              details,
            }}
          />
        </Container>
      </section>

      <section
        id="website-builder"
        className="scroll-mt-28 bg-paper pb-[clamp(72px,9vw,120px)]"
      >
        <Container>
          <div data-reveal>
            <WebsiteBuilderAddOn
              locale={locale === "fr" ? "fr" : "en"}
              copy={addOnCopy}
            />
          </div>
        </Container>
      </section>

      <section
        id="see-plans"
        className="scroll-mt-28 border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <PlanWalkthrough copy={walkthroughCopy} initialPlan="growth" />
          </div>
        </Container>
      </section>

      <section
        id="referral"
        className="scroll-mt-28 border-t border-[rgb(var(--ink-rgb)/0.08)] bg-paper"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <ReferralProgramTeaser
              locale={locale === "fr" ? "fr" : "en"}
              copy={referralCopy}
            />
          </div>
        </Container>
      </section>

      <section
        id="worth-it"
        className="scroll-mt-28 border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <PlanBreakEven
              locale={locale === "fr" ? "fr" : "en"}
              copy={t.raw("breakEven") as PlanBreakEvenCopy}
              plans={planIds.map((id, i) => ({
                id,
                name: tiers[i]!.name,
              }))}
            />
          </div>
        </Container>
      </section>

      <section
        id="compare"
        className="scroll-mt-28 border-t border-[rgb(var(--ink-rgb)/0.08)] bg-paper"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <PlanComparison data={comparison} />
          </div>
        </Container>
      </section>

      <StickyAuditCta label={cta("bookAuditShort")} />
    </>
  );
}
