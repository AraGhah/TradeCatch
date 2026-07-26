import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionHeading } from "@/components/SectionHeading";
import { CTAButton } from "@/components/CTAButton";
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

  const body = t.raw("body") as string[];
  const email = site("founderEmail");

  return (
    <>
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

      <section className="bg-paper py-[clamp(64px,7vw,110px)]">
        <Container>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "clamp(36px, 5vw, 80px)",
              alignItems: "start",
            }}
          >
            <div data-reveal>
              <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] border border-[rgba(12,20,30,0.1)] bg-paper-deep">
                <Image
                  src="/images/founder.jpg"
                  alt={t("caption")}
                  width={720}
                  height={900}
                  className="h-full w-full object-cover"
                  priority={false}
                />
              </div>
              <p className="mt-[18px] font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
                {t("caption")}
              </p>
            </div>

            <div data-reveal>
              <h2 className="m-0 font-heading text-[clamp(28px,3.2vw,42px)] font-extrabold leading-[1.06] tracking-[-0.038em] text-navy">
                {t("bodyHeadline")}
              </h2>
              <p className="mt-5 text-[17px] leading-[1.65] text-secondary">
                {t("bodyIntro")}
              </p>
              <ul className="mt-[30px] flex list-none flex-col p-0">
                {body.map((line, i) => (
                  <li
                    key={line}
                    className="flex items-start gap-3.5 border-t border-[rgba(12,20,30,0.1)] py-[15px] text-[16px] leading-[1.6] text-secondary"
                  >
                    <span className="pt-[3px] font-mono text-[12px] text-ember-text">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <CTAButton href="/book-audit" variant="ink" size="md">
                  {t("cta")}
                </CTAButton>
                <a
                  href={`mailto:${email}`}
                  className="inline-flex items-center rounded-[11px] border-[1.5px] border-[rgba(12,20,30,0.14)] px-[22px] py-4 text-[15.5px] font-semibold text-navy transition-colors hover:border-navy"
                >
                  {t("emailCta")}
                </a>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
