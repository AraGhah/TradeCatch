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
  const t = await getTranslations({ locale, namespace: "about" });
  return buildMetadata({
    locale,
    pathname: "/about",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const site = await getTranslations("site");
  const cta = await getTranslations("cta");

  const body = t.raw("body") as string[];

  return (
    <>
      <section className="bg-white py-16 sm:py-24">
        <Container>
          <SectionHeading as="h1" title={t("headline")} />
          <ul className="mx-auto mt-10 max-w-2xl space-y-3">
            {body.map((line) => (
              <li key={line} className="flex items-start gap-3 text-base text-text/80">
                <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-green" />
                {line}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-2xl rounded-xl border border-navy/10 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue">
              {t("founderTitle")}
            </p>
            <p className="mt-4 text-base leading-relaxed text-text/80">
              {t("founderBody")}
            </p>
            <p className="mt-6 text-sm text-text/60">{site("serviceArea")}</p>
            <p className="mt-1 text-sm text-text/60">{site("email")}</p>
          </div>

          <div className="mt-12 text-center">
            <CTAButton href="/book-audit">{cta("primary")}</CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
