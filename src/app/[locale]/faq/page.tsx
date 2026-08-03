import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { InternalHero } from "@/components/InternalHero";
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
  const heroTrust = t.raw("heroTrust") as string[];

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

      <InternalHero
        eyebrow={t("eyebrow")}
        title={t("headline")}
        intro={t("heroIntro")}
        aside={
          <ul className="m-0 flex list-none flex-col gap-3 border border-white/12 bg-white/[0.04] p-5">
            {heroTrust.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[14.5px] leading-[1.45] text-white/78"
              >
                <span aria-hidden className="text-orange">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        }
      />

      <section className="bg-paper pt-[clamp(28px,4vw,40px)] pb-[clamp(64px,8vw,100px)]">
        <Container size="faq">
          <div
            data-reveal
            className="border-t border-[rgb(var(--ink-rgb)/0.12)]"
          >
            <FaqAccordion items={items} />
          </div>

          <div
            data-reveal
            className="mt-10 bg-navy p-[clamp(28px,3.4vw,40px)] text-center text-white"
          >
            <h2 className="m-0 font-heading text-[clamp(22px,2.6vw,32px)] font-extrabold tracking-[-0.035em] text-white">
              {t("stillHave.headline")}
            </h2>
            <p className="mx-auto mt-3 max-w-[34em] text-[15.5px] leading-[1.6] text-white/66">
              {t("stillHave.body")}
            </p>
            <div className="mt-6">
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
