"use client";

import { useTranslations } from "next-intl";
import { Container } from "@/components/Container";
import { BrandLockup } from "@/components/BrandLockup";
import { IllustrativeBadge } from "@/components/IllustrativeBadge";
import { CTAButton } from "@/components/CTAButton";

export function OnePagerContent() {
  const t = useTranslations("onePager");
  const does = t.raw("does") as string[];
  const doesNot = t.raw("doesNot") as string[];
  const how = t.raw("how") as string[];

  return (
    <div className="bg-paper py-[clamp(40px,6vw,72px)] print:bg-white print:py-0">
      <Container className="max-w-[800px]">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 print:hidden">
          <BrandLockup />
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-[11px] bg-navy px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-navy-light"
          >
            {t("printCta")}
          </button>
        </div>

        <article className="border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(28px,4vw,48px)] print:border-0 print:p-0">
          <div className="print:mb-6">
            <div className="hidden print:block">
              <BrandLockup />
            </div>
            <IllustrativeBadge label={t("badge")} className="mt-4 print:mt-6" />
            <h1 className="mt-4 font-heading text-[clamp(28px,4vw,40px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-navy">
              {t("headline")}
            </h1>
            <p className="mt-4 text-[16.5px] leading-[1.65] text-secondary">
              {t("lede")}
            </p>
          </div>

          <section className="mt-8 border-t border-[rgba(12,20,30,0.1)] pt-6">
            <h2 className="font-heading text-[18px] font-bold text-navy">
              {t("forWhomTitle")}
            </h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-secondary">
              {t("forWhom")}
            </p>
          </section>

          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <section>
              <h2 className="font-heading text-[18px] font-bold text-navy">
                {t("doesTitle")}
              </h2>
              <ul className="mt-3 space-y-2">
                {does.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-[14.5px] leading-[1.5] text-secondary"
                  >
                    <span className="text-green" aria-hidden>
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="font-heading text-[18px] font-bold text-navy">
                {t("doesNotTitle")}
              </h2>
              <ul className="mt-3 space-y-2">
                {doesNot.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-[14.5px] leading-[1.5] text-secondary"
                  >
                    <span className="text-ember-text" aria-hidden>
                      ×
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="mt-8 border-t border-[rgba(12,20,30,0.1)] pt-6">
            <h2 className="font-heading text-[18px] font-bold text-navy">
              {t("howTitle")}
            </h2>
            <ol className="mt-3 space-y-2">
              {how.map((item, i) => (
                <li
                  key={item}
                  className="flex gap-3 text-[14.5px] leading-[1.5] text-secondary"
                >
                  <span className="font-mono text-[12px] font-semibold text-ember-text">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-8 grid gap-6 border-t border-[rgba(12,20,30,0.1)] pt-6 sm:grid-cols-2">
            <div>
              <h2 className="font-heading text-[18px] font-bold text-navy">
                {t("pricingTitle")}
              </h2>
              <p className="mt-2 text-[14.5px] leading-[1.55] text-secondary">
                {t("pricing")}
              </p>
            </div>
            <div>
              <h2 className="font-heading text-[18px] font-bold text-navy">
                {t("pilotTitle")}
              </h2>
              <p className="mt-2 text-[14.5px] leading-[1.55] text-secondary">
                {t("pilot")}
              </p>
            </div>
          </section>

          <section className="mt-8 rounded-[14px] bg-navy px-5 py-6 text-white print:break-inside-avoid">
            <h2 className="font-heading text-[20px] font-bold tracking-[-0.03em]">
              {t("ctaTitle")}
            </h2>
            <p className="mt-2 text-[15px] text-white/75">{t("cta")}</p>
            <p className="mt-4 font-mono text-[13px] text-orange">{t("contact")}</p>
            <div className="mt-5 print:hidden">
              <CTAButton href="/book-audit" variant="ember">
                {t("cta")}
              </CTAButton>
            </div>
          </section>

          <p className="mt-6 text-[12.5px] leading-[1.5] text-muted">
            {t("footerNote")}
          </p>
        </article>
      </Container>
    </div>
  );
}
