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
  const t = await getTranslations({ locale, namespace: "pricing" });
  return buildMetadata({
    locale,
    pathname: "/pricing",
    title: t("headline"),
    description: t("metaDescription"),
  });
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");

  const tiers = t.raw("tiers") as {
    name: string;
    price: string;
    cadence: string;
    items: string[];
    badge?: string;
  }[];
  const noSurprises = t.raw("noSurprises.items") as string[];

  return (
    <>
      <section className="bg-navy pt-[clamp(56px,7vw,96px)] pb-[clamp(80px,9vw,130px)]">
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

      <section className="bg-paper pb-[clamp(64px,8vw,120px)]">
        <Container>
          <div
            className="mt-[clamp(-60px,-5vw,-40px)]"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
              gap: "clamp(16px, 2vw, 24px)",
            }}
          >
            {tiers.map((tier) => {
              const popular = Boolean(tier.badge);
              return (
                <div
                  key={tier.name}
                  data-reveal
                  className="flex flex-col rounded-[20px] border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(28px,3vw,38px)] shadow-[0_30px_60px_-46px_rgba(12,20,30,0.45)] transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-[0_40px_70px_-40px_rgba(12,20,30,0.4)]"
                >
                  <div className="flex min-h-[26px] items-center justify-between gap-3">
                    <h2 className="m-0 font-heading text-[22px] font-bold tracking-[-0.03em] text-navy">
                      {tier.name}
                    </h2>
                    {popular ? (
                      <span className="rounded-full bg-[rgba(228,118,43,0.14)] px-[11px] py-[5px] font-mono text-[10px] font-semibold tracking-[0.12em] text-ember-text uppercase">
                        {t("mostPopular")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-[18px] font-heading text-[clamp(26px,2.6vw,32px)] font-extrabold leading-[1.1] tracking-[-0.036em] text-navy">
                    {tier.price}
                  </p>
                  <p className="mt-2 font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
                    {tier.cadence}
                  </p>
                  <ul className="mt-[26px] flex flex-1 list-none flex-col p-0">
                    {tier.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 border-t border-[rgba(12,20,30,0.08)] py-[11px] text-[15px] leading-[1.55] text-secondary"
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
                  <CTAButton
                    href="/book-audit"
                    variant="outline"
                    size="md"
                    className="mt-[26px]"
                  >
                    {t("cta")}
                  </CTAButton>
                </div>
              );
            })}
          </div>

          <div
            data-reveal
            className="mt-[clamp(32px,4vw,48px)] rounded-[18px] border border-[rgba(12,20,30,0.12)] bg-[rgba(255,255,255,0.5)] p-[clamp(26px,3vw,38px)]"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "clamp(20px, 3vw, 32px)",
            }}
          >
            <div>
              <p className="text-mono-label text-muted">{t("whyRange.title")}</p>
              <p className="mt-3.5 text-[16px] leading-[1.65] text-secondary">
                {t("whyRange.body")}
              </p>
            </div>
            <div>
              <p className="text-mono-label text-muted">
                {t("noSurprises.title")}
              </p>
              <ul className="mt-3.5 flex list-none flex-col gap-2.5 p-0">
                {noSurprises.map((item) => (
                  <li
                    key={item}
                    className="flex gap-[11px] text-[15.5px] leading-[1.55] text-secondary"
                  >
                    <span aria-hidden className="text-green">
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
