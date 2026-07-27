import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { InternalHero } from "@/components/InternalHero";
import { CTAButton } from "@/components/CTAButton";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "industriesPage" });
  return buildMetadata({
    locale,
    pathname: "/industries",
    title: t("headline"),
    description: t("intro"),
  });
}

export default async function IndustriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("industriesPage");

  const sections = t.raw("sections") as {
    name: string;
    headline: string;
    focus: string[];
  }[];

  return (
    <>
      <InternalHero
        eyebrow={t("eyebrow")}
        title={t("headline")}
        intro={t("intro")}
        aside={
          <div>
            <p className="mb-3 text-[13px] text-white/50">{t("selectLabel")}</p>
            <div className="flex flex-wrap gap-2">
              {sections.map((section, i) => (
                <a
                  key={section.name}
                  href={`#industry-${i}`}
                  className="border border-white/15 bg-white/[0.04] px-3.5 py-2 text-[14px] text-white/80 transition-colors hover:border-orange/50 hover:text-white"
                >
                  {section.name}
                </a>
              ))}
            </div>
          </div>
        }
      />

      <section className="bg-paper pt-[clamp(28px,4vw,40px)] pb-[clamp(64px,8vw,100px)]">
        <Container>
          {sections.map((section, i) => (
            <div
              key={section.name}
              id={`industry-${i}`}
              data-reveal
              className="scroll-mt-28 border-b border-[rgba(12,20,30,0.12)] py-[clamp(28px,3.4vw,40px)]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "clamp(16px, 3vw, 40px)",
              }}
            >
              <div>
                <p className="text-[13px] font-medium text-ember-text">
                  {t("focusLabel")}
                </p>
                <h2 className="mt-3 max-w-[min(100%,28rem)] font-heading text-[clamp(22px,2.6vw,32px)] font-bold leading-[1.12] tracking-[-0.03em] text-navy">
                  {section.headline}
                </h2>
                <p className="mt-2 text-[15px] font-semibold text-navy">
                  {section.name}
                </p>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {section.focus.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2.5 text-[15px] leading-[1.5] text-secondary"
                  >
                    <span aria-hidden className="text-green">
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

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
