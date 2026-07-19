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
  const t = await getTranslations({ locale, namespace: "industriesPage" });
  return { title: t("headline"), description: t("intro") };
}

export default async function IndustriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("industriesPage");
  const cta = await getTranslations("cta");

  const sections = t.raw("sections") as {
    name: string;
    headline: string;
    focus: string[];
  }[];

  return (
    <>
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading title={t("headline")} intro={t("intro")} />
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="space-y-8">
          {sections.map((section) => (
            <div
              key={section.name}
              className="grid gap-6 rounded-xl border border-navy/10 bg-white p-8 shadow-sm md:grid-cols-3"
            >
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue">
                  {section.name}
                </p>
                <h3 className="mt-2 text-xl font-bold leading-snug text-navy">
                  {section.headline}
                </h3>
              </div>
              <ul className="md:col-span-2 grid gap-2 sm:grid-cols-2">
                {section.focus.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-text/80">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="text-center">
            <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
