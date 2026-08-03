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

  const groups = t.raw("groups") as {
    title: string;
    purpose: string;
    items: string[];
  }[];
  const later = t.raw("later") as string[];
  const highlights = t.raw("heroHighlights") as string[];

  return (
    <>
      <InternalHero
        eyebrow={t("eyebrow")}
        title={t("headline")}
        intro={t("intro")}
        aside={
          <ol className="m-0 list-none p-0">
            {highlights.map((item, i) => (
              <li
                key={item}
                className="flex items-center gap-3 border-t border-white/12 py-2.5 text-[15px] text-white/80 first:border-t-0 first:pt-0"
              >
                <span className="font-mono text-[11px] text-orange">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item}
              </li>
            ))}
          </ol>
        }
      />

      <section className="bg-paper pt-[clamp(36px,4vw,52px)] pb-[clamp(64px,7vw,100px)]">
        <Container className="flex flex-col gap-[clamp(14px,2vw,20px)]">
          {groups.map((group, i) => (
            <div
              key={group.title}
              data-reveal
              className="border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-[clamp(24px,3vw,36px)] transition-[box-shadow,border-color] duration-300 hover:border-[rgb(var(--ink-rgb)/0.2)] hover:shadow-[0_24px_48px_-34px_rgb(var(--ink-rgb)/0.28)]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "clamp(20px, 3vw, 40px)",
              }}
            >
              <div>
                <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="mt-3 font-heading text-[clamp(22px,2.4vw,30px)] font-bold tracking-[-0.03em] text-heading">
                  {group.title}
                </h2>
                <p className="mt-2.5 max-w-[32em] text-[15.5px] leading-[1.6] text-muted">
                  {group.purpose}
                </p>
              </div>
              <ul
                className="m-0 list-none p-0"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "2px 20px",
                  alignContent: "start",
                }}
              >
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 py-2 text-[14.5px] leading-[1.5] text-secondary"
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

          <div
            data-reveal
            className="mt-4 border border-[rgb(var(--ink-rgb)/0.1)] bg-navy p-[clamp(28px,3.4vw,40px)] text-white"
          >
            <h2 className="m-0 font-heading text-[clamp(22px,2.5vw,30px)] font-bold tracking-[-0.03em]">
              {t("laterTitle")}
            </h2>
            <p className="mt-3 max-w-[36em] text-[15.5px] leading-[1.6] text-white/65">
              {t("laterIntro")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {later.map((item) => (
                <span
                  key={item}
                  className="border border-white/15 px-3.5 py-2 text-[14px] text-white/75"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-8">
              <CTAButton href="/book-audit" variant="ember">
                {t("cta")}
              </CTAButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
