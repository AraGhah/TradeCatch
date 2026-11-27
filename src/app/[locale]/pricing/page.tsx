import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { StickyAuditCta } from "@/components/StickyAuditCta";
import { PricingDetails } from "@/components/PricingDetails";
import {
  TradeCatchOfferSection,
  type OfferFeatureGroup,
  type TradeCatchOffer,
} from "@/components/ui/tradecatch-offer-section";
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
import { schedulingVerified } from "@/lib/launch-flags";
import { comparisonRowsFromCatalog } from "@/lib/plan-marketing";
import { planDisplayName } from "@/lib/plan-names";
import {
  formatPlanMoney,
  formatPlanPrice,
  PLAN_PRICES,
  type PlanId as PricePlanId,
} from "@/lib/plans";
import { buildMetadata } from "@/lib/seo";
import {
  CAPABILITIES,
  capabilityAvailability,
  PLAN_ORDER,
  REFERRAL_MAX_REWARD_CENTS,
  REFERRAL_ESSENTIAL_REWARD_CENTS,
  REFERRAL_PROFESSIONAL_REWARD_CENTS,
  REFERRAL_WEBSITE_BONUS_CENTS,
  type PlanId,
} from "@/product/saas/plan-catalog";

const LAUNCH_PLAN_IDS = ["essential", "professional"] as const satisfies readonly PricePlanId[];

/** The card copy in messages/{en,fr}.json under pricing.tiers. */
type TierCopy = {
  name: string;
  tagline: string;
  outcome: string;
  idealFor: string;
  badge?: string;
  emphasis?: "featured";
  reassuranceLine?: string;
  stepUp?: string;
  includesPrevious?: string;
  groups: OfferFeatureGroup[];
  ctaLabel?: string;
  planInterest?: string;
};

/** Read from the entitlement catalog, so the rail cannot promise booking to a plan without it. */
function booksAppointments(plan: PlanId): boolean {
  const calendar = CAPABILITIES.find((c) => c.id === "googleCalendar")!;
  return capabilityAvailability(plan, calendar) === "included";
}

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

  // Monthly and setup amounts always come from PLAN_PRICES so card copy cannot drift.
  const flow = t.raw("flow") as Record<"label" | "answered" | "captured" | "booked", string>;
  const offers: TradeCatchOffer[] = (t.raw("tiers") as TierCopy[]).map((tier, index) => {
    const planId =
      LAUNCH_PLAN_IDS.find((id) => id === tier.planInterest) ??
      LAUNCH_PLAN_IDS[index] ??
      "essential";
    const amounts = PLAN_PRICES[planId];
    const priceNotes = [
      tier.reassuranceLine,
      !schedulingLive && planId === "professional" ? t("schedulingNote") : undefined,
    ].filter((note): note is string => Boolean(note));
    return {
      id: planId,
      title: tier.name,
      tagline: tier.tagline,
      description: tier.outcome,
      audience: tier.idealFor,
      badge: tier.badge,
      featured: tier.emphasis === "featured",
      amountLabel: t("monthlyEyebrow"),
      amount: formatPlanPrice(amounts.monthly, lang),
      amountSuffix: `/ ${t("periodLabel")}`,
      oneTimeFee: {
        label: t("setupLabel"),
        amount: formatPlanPrice(amounts.setup, lang),
        note: t("onceLabel"),
      },
      highlight: tier.stepUp,
      priceNotes,
      rail: {
        label: flow.label,
        unreachedLabel: t("comparison.notIncludedLabel"),
        stages: [
          { icon: "call", label: flow.answered, reached: true },
          { icon: "lead", label: flow.captured, reached: true },
          { icon: "booking", label: flow.booked, reached: booksAppointments(planId) },
        ],
      },
      includesPrevious: tier.includesPrevious,
      groups: tier.groups,
      // The plan travels with the demo request so the lead stays attributable.
      cta: {
        label: tier.ctaLabel ?? t("cta"),
        href: { pathname: "/book-audit", query: { plan: planId } },
      },
      footnote: (
        <a
          href="#website-service"
          className="underline decoration-1 underline-offset-[3px] transition-colors hover:text-heading"
        >
          {t("websiteMention")}
        </a>
      ),
    };
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
      (id) => [id, planDisplayName(id)],
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

      <TradeCatchOfferSection
        mode="pricing"
        eyebrow={t("eyebrow")}
        title={t("headline")}
        description={t("intro")}
        headerExtra={
          <p className="mx-auto mt-4 w-fit max-w-full rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.14)] bg-surface px-4 py-2.5 text-[14px] leading-[1.45] font-medium text-heading">
            {t("billingBanner")}
          </p>
        }
        offers={offers}
        afterOffers={
          <>
            <ul className="m-0 grid list-none gap-x-5 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {principles.map((item) => (
                <li
                  key={item}
                  className="border-t border-[rgb(var(--ink-rgb)/0.14)] py-3 text-[14px] leading-[1.45] font-medium text-secondary"
                >
                  {item}
                </li>
              ))}
            </ul>
            <p className="m-0 text-center text-[13.5px] text-muted">{t("reassurance")}</p>
            <div className="mt-[clamp(24px,3vw,36px)]">
              <WebsiteServiceAddOn copy={websiteServiceCopy} />
            </div>
            <PricingDetails
              includesTitle={t("includesTitle")}
              includesItems={t.raw("includesItems") as string[]}
              details={details}
            />
          </>
        }
      />

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
