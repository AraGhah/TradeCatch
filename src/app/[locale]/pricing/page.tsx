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
  WebsiteServiceAddOn,
  type WebsiteServiceAddOnCopy,
} from "@/components/WebsiteServiceAddOn";
import {
  ReferralProgramTeaser,
  type ReferralProgramTeaserCopy,
} from "@/components/ReferralProgramTeaser";
import { localizedAnchor } from "@/lib/anchors";
import { schedulingVerified } from "@/lib/launch-flags";
import { comparisonRowsFromCatalog } from "@/lib/plan-marketing";
import { formatPlanMoney } from "@/lib/plans";
import { buildMetadata } from "@/lib/seo";
import {
  PLAN_ORDER,
  REFERRAL_MAX_REWARD_CENTS,
  REFERRAL_ESSENTIAL_REWARD_CENTS,
  REFERRAL_PROFESSIONAL_REWARD_CENTS,
  REFERRAL_WEBSITE_BONUS_CENTS,
  type PlanId,
} from "@/product/saas/plan-catalog";

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
  const lang = locale === "fr" ? "fr" : "en";
  const t = await getTranslations("pricing");
  const plans = await getTranslations("plans");
  const cta = await getTranslations("cta");

  // Appointment scheduling is advertised as operational only after the operator
  // confirms live verification (see launch-flags.ts). Until then the Professional
  // card says plainly that it is switched on per business after testing.
  const schedulingLive = schedulingVerified();

  // Hash links need the visitor's localized path (see localizedAnchor).
  const tiers = (t.raw("tiers") as PricingTier[]).map((tier) => {
    const linked = tier.secondaryCtaHref?.includes("#")
      ? {
          ...tier,
          secondaryCtaHref: localizedAnchor(locale, tier.secondaryCtaHref),
        }
      : tier;
    return !schedulingLive && linked.planInterest === "professional"
      ? { ...linked, usageNote: t("schedulingNote") }
      : linked;
  });
  const principles = t.raw("principles") as string[];
  const details = t.raw("details") as { title: string; body: string }[];

  // The comparison table is generated from the entitlements the backend
  // enforces, so it cannot show Essential with a feature it does not have.
  const comparisonCopy = t.raw("comparison") as Omit<
    PlanComparisonData,
    "columns" | "rows"
  >;
  const comparison: PlanComparisonData = {
    ...comparisonCopy,
    columns: PLAN_ORDER.map((id) => plans(`names.${id}`)),
    rows: comparisonRowsFromCatalog().map((row) => ({
      feature: plans(`capabilities.${row.capabilityId}.label`),
      values: row.values,
    })),
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: details.map((detail) => ({
      "@type": "Question",
      name: detail.title,
      acceptedAnswer: { "@type": "Answer", text: detail.body },
    })),
  };

  const websiteServiceCopy: WebsiteServiceAddOnCopy = {
    eyebrow: plans("addOns.websiteService.eyebrow"),
    title: plans("addOns.websiteService.title"),
    intro: plans("addOns.websiteService.intro"),
    price: plans("addOns.websiteService.price"),
    priceNote: plans("addOns.websiteService.priceNote"),
    availableOn: plans("addOns.websiteService.availableOn"),
    neverIncluded: plans("addOns.websiteService.neverIncluded"),
    includesTitle: plans("addOns.websiteService.includesTitle"),
    includes: plans.raw("addOns.websiteService.includes") as string[],
    cta: plans("addOns.websiteService.cta"),
  };

  const referralT = await getTranslations("referrals.public");
  const money = (cents: number) => formatPlanMoney(cents / 100, lang, 0);
  const referralAmounts = {
    essentialReward: money(REFERRAL_ESSENTIAL_REWARD_CENTS),
    professionalReward: money(REFERRAL_PROFESSIONAL_REWARD_CENTS),
    bonus: money(REFERRAL_WEBSITE_BONUS_CENTS),
    max: money(REFERRAL_MAX_REWARD_CENTS),
  };
  const planNames = Object.fromEntries(
    (["essential", "professional", "starter", "growth", "receptionist"] as PlanId[]).map(
      (id) => [id, plans(`names.${id}`)],
    ),
  ) as Record<PlanId, string>;
  const referralCopy: ReferralProgramTeaserCopy = {
    eyebrow: referralT("eyebrow"),
    title: referralT("headline", referralAmounts),
    intro: referralT("intro", referralAmounts),
    youEarn: referralT("youEarn"),
    giftCard: referralT("giftCard"),
    bonusTitle: referralT("bonusTitle"),
    bonusLabel: referralT("bonusLabel"),
    maxNote: referralT("maxNote", referralAmounts),
    cta: plans("referralTeaser.cta"),
    planNames,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <section className="relative overflow-hidden bg-navy pt-[clamp(44px,5.4vw,72px)] pb-[clamp(48px,6vw,80px)]">
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
              <p className="mt-4 max-w-[34em] rounded-[12px] border border-orange/40 bg-[rgba(228,118,43,0.16)] px-3.5 py-2.5 text-[14px] leading-[1.45] text-white/90">
                {t("billingBanner")}
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
              includesTitle: t("includesTitle"),
              includesItems: t.raw("includesItems") as string[],
              websiteMention: t("websiteMention"),
              details,
            }}
            afterPlans={<WebsiteServiceAddOn copy={websiteServiceCopy} />}
          />
        </Container>
      </section>

      <section
        id="compare"
        className="scroll-mt-28 border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface"
        style={{ padding: "var(--section-y) 0" }}
      >
        <Container>
          <div data-reveal>
            <PlanComparison data={comparison} />
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
            <ReferralProgramTeaser locale={lang} copy={referralCopy} />
          </div>
        </Container>
      </section>

      <StickyAuditCta label={cta("bookAuditShort")} />
    </>
  );
}
