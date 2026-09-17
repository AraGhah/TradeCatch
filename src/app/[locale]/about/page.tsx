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
  const heroPoints = t.raw("heroPoints") as string[];
  const snapshot = t.raw("snapshot") as { label: string; value: string }[];
  const email = site("founderEmail");

  return (
    <>
      <InternalHero
        eyebrow={t("eyebrow")}
        title={t("headline")}
        aside={
          <div className="border border-white/12 bg-white/[0.04] p-5">
            <p className="text-[15.5px] leading-[1.6] text-white/75">
              {t("heroIntro")}
            </p>
            <ul className="mt-5 flex list-none flex-col gap-2.5 p-0">
              {heroPoints.map((point) => (
                <li
                  key={point}
                  className="flex gap-2.5 text-[14px] leading-[1.45] text-white/70"
                >
                  <span aria-hidden className="text-orange">
                    ✓
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <section className="bg-paper pt-[clamp(36px,4vw,52px)] pb-[clamp(64px,7vw,100px)]">
        <Container>
          <div
            className="grid items-start"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "clamp(28px, 4vw, 64px)",
            }}
          >
            <div
              data-reveal
              className="mx-auto w-full max-w-[420px] -mt-10 max-lg:mt-0 lg:-mt-16"
            >
              <div className="border border-[rgb(var(--ink-rgb)/0.1)] bg-paper-deep p-[clamp(22px,2.6vw,30px)] shadow-[0_28px_50px_-36px_rgb(var(--ink-rgb)/0.45)]">
                <p className="font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
                  {t("snapshotLabel")}
                </p>
                <dl className="mt-5 m-0 flex flex-col">
                  {snapshot.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-5 border-t border-[rgb(var(--ink-rgb)/0.1)] py-3.5 first:border-t-0 first:pt-0"
                    >
                      <dt className="text-[13.5px] text-muted">{row.label}</dt>
                      <dd className="m-0 text-right text-[14.5px] font-semibold tracking-[-0.015em] text-heading">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="mt-4 text-[13px] leading-[1.55] text-muted">
                {t("snapshotNote")}
              </p>
            </div>

            <div data-reveal>
              <h2 className="m-0 font-heading text-[clamp(26px,3vw,38px)] font-extrabold leading-[1.06] tracking-[-0.038em] text-heading">
                {t("bodyHeadline")}
              </h2>
              <p className="mt-4 text-[16.5px] leading-[1.65] text-secondary">
                {t("bodyIntro")}
              </p>
              <ul className="mt-7 flex list-none flex-col p-0">
                {body.map((line, i) => (
                  <li
                    key={line}
                    className="flex items-start gap-3 border-t border-[rgb(var(--ink-rgb)/0.1)] py-3.5 text-[15.5px] leading-[1.55] text-secondary"
                  >
                    <span className="pt-0.5 font-mono text-[11px] text-ember-text">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-3">
                <CTAButton href="/book-audit" variant="ink" size="md">
                  {t("cta")}
                </CTAButton>
                <a
                  href={`mailto:${email}`}
                  className="inline-flex items-center border-[1.5px] border-[rgb(var(--ink-rgb)/0.14)] px-[22px] py-3.5 text-[15px] font-semibold text-heading transition-colors hover:border-navy"
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
