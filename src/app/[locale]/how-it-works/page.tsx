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

  const stages = t.raw("stages") as { title: string; items: string[] }[];
  const sequence = t.raw("sequence") as { day: string; action: string }[];

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
            intro={t("intro")}
          />
        </Container>
      </section>

      <section className="bg-paper py-[clamp(64px,7vw,110px)]">
        <Container size="how">
          {stages.map((stage, i) => (
            <div
              key={stage.title}
              data-reveal
              className="border-t border-[rgba(12,20,30,0.12)] py-[clamp(28px,3vw,40px)]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "clamp(20px, 3vw, 48px)",
              }}
            >
              <div className="flex items-start gap-[18px]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-navy font-mono text-[13px] font-semibold text-orange">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="mt-2 font-heading text-[clamp(21px,2.3vw,28px)] font-bold leading-[1.15] tracking-[-0.03em] text-navy">
                  {stage.title}
                </h2>
              </div>
              <ul className="m-0 flex list-none flex-wrap content-start items-start gap-2 p-0">
                {stage.items.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-[rgba(12,20,30,0.1)] bg-white px-3.5 py-2 text-[14px] text-secondary transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-navy"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div
            data-reveal
            className="mt-[clamp(40px,5vw,64px)] rounded-[20px] border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(28px,3.4vw,44px)]"
          >
            <p className="text-[13px] font-medium text-ember-text">{t("sequenceTitle")}</p>
            <div className="mt-[26px] grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sequence.map((step) => (
                <div
                  key={step.day}
                  className="border border-[rgba(12,20,30,0.1)] bg-paper px-5 py-[22px]"
                >
                  <p className="text-[12px] font-semibold text-ember-text">
                    {step.day}
                  </p>
                  <p className="mt-[9px] text-[15.5px] leading-[1.55] text-text">
                    {step.action}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-[22px] text-[15px] leading-[1.62] text-muted">
              {t("sequenceNote")}
            </p>
          </div>

          <div data-reveal className="mt-10 text-center">
            <CTAButton href="/book-audit" variant="ink" size="lg">
              {t("cta")}
            </CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
