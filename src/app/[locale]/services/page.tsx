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
        <Container className="flex flex-col gap-[clamp(16px,2vw,24px)]">
          {groups.map((group, i) => (
            <div
              key={group.title}
              data-reveal
              className="rounded-[20px] border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(28px,3.4vw,44px)] transition-[box-shadow,border-color] duration-300 hover:border-[rgba(12,20,30,0.2)] hover:shadow-[0_28px_54px_-34px_rgba(12,20,30,0.32)]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "clamp(24px, 3vw, 48px)",
              }}
            >
              <div>
                <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-ember-text">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="mt-4 font-heading text-[clamp(24px,2.6vw,32px)] font-bold tracking-[-0.032em] text-navy">
                  {group.title}
                </h2>
                <p className="mt-3 max-w-[26em] text-[16px] leading-[1.62] text-muted">
                  {group.purpose}
                </p>
              </div>
              <ul
                className="m-0 list-none p-0"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                  gap: "2px 24px",
                  alignContent: "start",
                }}
              >
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-[11px] py-[9px] text-[15px] leading-[1.55] text-secondary"
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
          ))}

          <div
            data-reveal
            className="mt-4 rounded-[20px] bg-navy p-[clamp(28px,3.4vw,44px)] text-white"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "clamp(24px, 3vw, 48px)",
            }}
          >
            <div>
              <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-[rgba(255,255,255,0.64)]">
                Later
              </span>
              <h2 className="mt-4 font-heading text-[clamp(24px,2.6vw,32px)] font-bold tracking-[-0.032em] text-white">
                {t("laterTitle")}
              </h2>
              <p className="mt-3 max-w-[26em] text-[16px] leading-[1.62] text-[rgba(255,255,255,0.62)]">
                {t("laterIntro")}
              </p>
            </div>
            <ul className="m-0 flex list-none flex-wrap content-start gap-[9px] p-0">
              {later.map((item) => (
                <li
                  key={item}
                  className="rounded-full border border-[rgba(255,255,255,0.16)] px-[15px] py-2 text-[14px] text-[rgba(255,255,255,0.78)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div data-reveal className="mt-6 text-center">
            <CTAButton href="/book-audit" variant="ember" size="lg">
              {t("cta")}
            </CTAButton>
          </div>
        </Container>
      </section>
    </>
  );
}
