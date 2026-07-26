import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { FaqAccordion } from "@/components/FaqAccordion";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  return buildMetadata({
    locale,
    pathname: "/faq",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("faq");

  const items = t.raw("items") as { q: string; a: string }[];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <section className="bg-navy pt-[clamp(56px,7vw,96px)] pb-[clamp(64px,8vw,100px)]">
        <Container>
          <SectionHeading
            as="h1"
            light
            align="left"
            eyebrow={t("eyebrow")}
            title={t("headline")}
          />
        </Container>
      </section>

      <section className="bg-paper pt-[clamp(56px,6vw,96px)] pb-[clamp(72px,8vw,120px)]">
        <Container size="faq">
          <div data-reveal className="border-t border-[rgba(12,20,30,0.12)]">
            <FaqAccordion items={items} />
          </div>

          <div
            data-reveal
            className="mt-12 rounded-[20px] bg-navy p-[clamp(28px,3.4vw,40px)] text-center text-white"
          >
            <h2 className="m-0 font-heading text-[clamp(24px,2.8vw,34px)] font-extrabold tracking-[-0.036em] text-white">
              {t("stillHave.headline")}
            </h2>
            <p className="mx-auto mt-3.5 max-w-[34em] text-[16px] leading-[1.62] text-[rgba(255,255,255,0.66)]">
              {t("stillHave.body")}
            </p>
            <div className="mt-[26px]">
              <CTAButton href="/book-audit" variant="ember" size="md">
                {t("stillHave.cta")}
              </CTAButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
