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

      <section className="bg-paper pt-[clamp(48px,6vw,88px)] pb-[clamp(64px,8vw,120px)]">
        <Container>
          {sections.map((section, i) => (
            <div
              key={section.name}
              data-reveal
              className="border-b border-[rgba(12,20,30,0.12)] py-[clamp(32px,3.6vw,48px)]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "clamp(20px, 3vw, 56px)",
              }}
            >
              <div>
                <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-ember-text uppercase">
                  {String(i + 1).padStart(2, "0")} · {section.name}
                </span>
                <h2 className="mt-4 max-w-[14em] font-heading text-[clamp(24px,2.8vw,34px)] font-bold leading-[1.12] tracking-[-0.034em] text-navy">
                  {section.headline}
                </h2>
              </div>
              <div>
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase">
                  {t("focusLabel")}
                </p>
                <ul
                  className="mt-4 list-none p-0"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                    gap: "2px 24px",
                  }}
                >
                  {section.focus.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-[11px] py-[9px] text-[15.5px] leading-[1.55] text-secondary"
                    >
                      <span
                        aria-hidden
                        className="shrink-0 text-[13px] leading-[1.6] text-green"
                      >
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}

          <div data-reveal className="mt-12 text-center">
            <CTAButton href="/book-audit" variant="ember" size="lg">
              {t("cta")}
            </CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
