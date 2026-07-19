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
  const cta = await getTranslations("cta");

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
      <section className="bg-white py-16 sm:py-24">
        <Container className="max-w-3xl">
          <SectionHeading as="h1" title={t("headline")} />
          <div className="mt-12">
            <FaqAccordion items={items} />
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="text-center">
          <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
        </Container>
      </section>
    </>
  );
}
