import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
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
  const principles = t.raw("principles") as string[];

  return (
    <>
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

      <section className="bg-paper pb-[clamp(72px,9vw,120px)]">
        <Container>
          <PricingExperience
            tiers={tiers}
            labels={{
              mostPopular: t("mostPopular"),
              cta: t("cta"),
              setupLabel: t("setupLabel"),
              monthlyLabel: t("monthlyLabel"),
              thenLabel: t("thenLabel"),
              customTitle: t("customTitle"),
              customBody: t("customBody"),
              customCta: t("customCta"),
              includesTitle: t("includesTitle"),
              includesItems: t.raw("includesItems") as string[],
              details: t.raw("details") as { title: string; body: string }[],
            }}
          />
        </Container>
      </section>

      <StickyAuditCta label={cta("bookAuditShort")} />
    </>
  );
}
