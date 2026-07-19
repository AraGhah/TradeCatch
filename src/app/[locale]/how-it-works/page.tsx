import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorks" });
  return { title: t("headline") };
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
          <SectionHeading title={t("headline")} />
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <ol className="grid gap-6 lg:grid-cols-6">
            {stages.map((stage, i) => (
              <li
                key={stage.title}
                className="flex flex-col rounded-xl border border-navy/10 bg-white p-5 shadow-sm"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
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
              </li>
            ))}
          </ol>

          <div className="mt-12 text-center">
            <CTAButton href="/book-audit">{cta("seeSystemWorkflow")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
