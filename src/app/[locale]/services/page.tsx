import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { CheckIcon } from "@/components/icons";
import { Reveal } from "@/components/motion/Reveal";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "services" });
  return buildMetadata({
    locale,
    pathname: "/services",
    title: t("headline"),
    description: t("intro"),
  });
}

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("services");
  const cta = await getTranslations("cta");

  const groups = t.raw("groups") as {
    title: string;
    purpose: string;
    items: string[];
  }[];
  const later = t.raw("later") as string[];

  return (
    <>
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading as="h1" title={t("headline")} intro={t("intro")} />
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="space-y-6">
          {groups.map((group, i) => (
            <Reveal
              key={group.title}
              delay={i * 0.05}
              className="grid gap-6 rounded-xl border border-navy/10 bg-white p-8 shadow-card transition-shadow duration-200 hover:shadow-card-hover md:grid-cols-3"
            >
              <div className="flex gap-4 md:flex-col md:gap-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-xl font-bold text-navy md:mt-3">{group.title}</h3>
                  <p className="mt-2 text-sm text-text/70">{group.purpose}</p>
                </div>
              </div>
              <ul className="md:col-span-2 grid gap-2.5 sm:grid-cols-2">
                {group.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-text/80">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}

          <Reveal className="rounded-xl border border-dashed border-navy/20 bg-bg p-8">
            <h3 className="text-lg font-semibold text-navy">{t("laterTitle")}</h3>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {later.map((item) => (
                <li key={item} className="text-sm text-text/70">
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <div className="pt-4 text-center">
            <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
