import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { CheckIcon } from "@/components/icons";
import { StaggerGroup, StaggerItem } from "@/components/motion/StaggerGroup";
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

  const tiers = t.raw("tiers") as { name: string; price: string; items: string[] }[];

  return (
    <>
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading as="h1" title={t("headline")} />
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <StaggerGroup className="grid gap-6 lg:grid-cols-3 lg:items-start">
            {tiers.map((tier, i) => (
              <StaggerItem key={tier.name} className="h-full">
                <div
                  className={`relative flex h-full flex-col rounded-xl border p-8 transition-shadow duration-200 ${
                    i === 1
                      ? "border-orange bg-white shadow-card-hover ring-1 ring-orange/30 lg:-translate-y-2"
                      : "border-navy/10 bg-white shadow-card hover:shadow-card-hover"
                  }`}
                >
                  {i === 1 ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-orange px-3 py-1 text-xs font-bold uppercase tracking-wide text-navy shadow-cta">
                      {t("mostPopular")}
                    </span>
                  ) : null}
                  <h3 className="text-xl font-bold text-navy">{tier.name}</h3>
                  <p className="mt-2 text-base font-semibold text-blue">{tier.price}</p>
                  <ul className="mt-6 flex-1 space-y-2.5">
                    {tier.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-text/80">
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <CTAButton
                    href="/book-audit"
                    variant={i === 1 ? "primary" : "secondary"}
                    className="mt-8"
                  >
                    {cta("primary")}
                  </CTAButton>
                </div>
              </StaggerItem>
            ))}
          </StaggerGroup>

          <p className="mx-auto mt-12 max-w-2xl text-center text-sm text-text/70">
            {t("disclaimer")}
          </p>
        </Container>
      </section>
    </>
  );
}
