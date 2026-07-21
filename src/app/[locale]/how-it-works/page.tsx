import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { StaggerGroup, StaggerItem } from "@/components/motion/StaggerGroup";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorks" });
  return buildMetadata({
    locale,
    pathname: "/how-it-works",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("howItWorks");
  const cta = await getTranslations("cta");

  const stages = t.raw("stages") as { title: string; items: string[] }[];

  return (
    <>
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading as="h1" title={t("headline")} />
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <StaggerGroup className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {stages.map((stage, i) => (
              <StaggerItem key={stage.title} className="h-full">
                <div className="group flex h-full flex-col rounded-xl border border-navy/10 bg-white p-5 shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-sm font-bold text-white transition-colors group-hover:bg-orange group-hover:text-navy">
                    {i + 1}
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-navy">
                    {stage.title}
                  </h3>
                  <ul className="mt-3 space-y-1.5">
                    {stage.items.map((item) => (
                      <li key={item} className="text-xs leading-relaxed text-text/70">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </StaggerItem>
            ))}
          </StaggerGroup>

          <div className="mt-12 text-center">
            <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
