import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { CheckIcon } from "@/components/icons";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return { title: t("headline") };
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
          <SectionHeading title={t("headline")} />
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((tier, i) => (
              <div
                key={tier.name}
                className={`flex flex-col rounded-xl border p-8 ${
                  i === 1
                    ? "border-orange bg-white shadow-md ring-1 ring-orange/30"
                    : "border-navy/10 bg-white shadow-sm"
                }`}
              >
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
                  {cta("getRecommendation")}
                </CTAButton>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-text/60">
            {t("disclaimer")}
          </p>
        </Container>
      </section>
    </>
  );
}
