import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { StickyAuditCta } from "@/components/StickyAuditCta";
import {
  PricingExperience,
  type PricingTier,
} from "@/components/PricingExperience";
import { buildMetadata } from "@/lib/seo";

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
  const cta = await getTranslations("cta");

  const tiers = t.raw("tiers") as PricingTier[];

  return (
    <>
      <section className="bg-navy pt-[clamp(56px,7vw,88px)] pb-[clamp(48px,6vw,72px)]">
        <Container>
          <div className="max-w-[48rem]">
            <SectionHeading
              as="h1"
              light
              align="left"
              eyebrow={t("eyebrow")}
              title={t("headline")}
              intro={t("intro")}
              className="max-w-none"
            />
          </div>
        </Container>
      </section>

      <section className="bg-paper pb-[clamp(72px,9vw,120px)] pt-[clamp(36px,4vw,52px)]">
        <Container>
          <PricingExperience
            tiers={tiers}
            labels={{
              mostPopular: t("mostPopular"),
              cta: t("cta"),
              forWhomLabel: t("forWhomLabel"),
              includesLabel: t("includesLabel"),
              setupLabel: t("setupLabel"),
              monthlyLabel: t("monthlyLabel"),
              comparisonTitle: t("comparison.title"),
              comparisonSetup: t("comparison.setup"),
              comparisonMonthly: t("comparison.monthly"),
              comparisonBestFor: t("comparison.bestFor"),
              comparisonTechs: t("comparison.techs"),
              whyRangeTitle: t("whyRange.title"),
              whyRangeBody: t("whyRange.body"),
              noSurprisesTitle: t("noSurprises.title"),
              noSurprisesItems: t.raw("noSurprises.items") as string[],
              overageTitle: t("overage.title"),
              overageBody: t("overage.body"),
              dataOwnershipTitle: t("dataOwnership.title"),
              dataOwnershipBody: t("dataOwnership.body"),
              afterCancelTitle: t("afterCancel.title"),
              afterCancelBody: t("afterCancel.body"),
            }}
          />
        </Container>
      </section>

      <StickyAuditCta label={cta("bookAuditShort")} />
    </>
  );
}
