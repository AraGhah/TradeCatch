import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
import { CheckIcon } from "@/components/icons";
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
        <Container className="space-y-10">
          {groups.map((group, i) => (
            <div
              key={group.title}
              className="grid gap-6 rounded-xl border border-navy/10 bg-white p-8 shadow-sm md:grid-cols-3"
            >
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-blue">
                  Group {i + 1}
                </p>
                <h3 className="mt-2 text-2xl font-bold text-navy">{group.title}</h3>
                <p className="mt-3 text-sm text-text/70">{group.purpose}</p>
              </div>
              <ul className="md:col-span-2 grid gap-2 sm:grid-cols-2">
                {group.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-text/80">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="rounded-xl border border-dashed border-navy/20 bg-bg p-8">
            <h3 className="text-lg font-semibold text-navy">{t("laterTitle")}</h3>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {later.map((item) => (
                <li key={item} className="text-sm text-text/70">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="text-center">
            <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
