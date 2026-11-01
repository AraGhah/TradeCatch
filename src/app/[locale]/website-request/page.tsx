import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { WebsiteRequestForm } from "@/components/WebsiteRequestForm";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "websiteRequest.meta" });
  return buildMetadata({
    locale,
    pathname: "/website-request",
    title: t("title"),
    description: t("description"),
  });
}

/**
 * "Get My Website Built": the short request form behind the pricing page's
 * Done-for-You Website Service. It records a request only. The scope and the
 * final price are confirmed in writing before the customer pays anything.
 */
export default async function WebsiteRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("websiteRequest.page");
  const steps = t.raw("steps") as string[];

  return (
    <>
      <section className="relative overflow-hidden bg-navy pt-[clamp(72px,8vw,104px)] pb-[clamp(56px,7vw,88px)]">
        <Container className="relative">
          <p className="text-[13px] font-medium text-orange">{t("eyebrow")}</p>
          <h1
            className="mt-4 max-w-[16em] font-heading font-extrabold text-white"
            style={{
              fontSize: "clamp(34px, 5vw, 56px)",
              lineHeight: 1,
              letterSpacing: "-0.04em",
            }}
          >
            {t("headline")}
          </h1>
          <p className="mt-5 max-w-[36em] text-[clamp(16px,1.35vw,18px)] leading-[1.6] text-white/70">
            {t("intro")}
          </p>
        </Container>
      </section>

      <section className="bg-paper py-[clamp(48px,6vw,88px)]">
        <Container>
          <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[1.2fr_0.8fr]">
            <WebsiteRequestForm mode="public" />

            <aside className="lg:border-l lg:border-[rgb(var(--ink-rgb)/0.14)] lg:pl-10">
              <h2 className="font-heading text-[22px] font-extrabold tracking-[-0.03em] text-heading">
                {t("stepsTitle")}
              </h2>
              <ol className="mt-6 flex list-none flex-col gap-5 p-0">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span
                      aria-hidden
                      className="font-heading text-[28px] leading-none font-extrabold text-orange"
                    >
                      {index + 1}
                    </span>
                    <span className="text-[15.5px] leading-[1.55] text-secondary">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-8 border-t border-[rgb(var(--ink-rgb)/0.12)] pt-5 text-[14px] leading-[1.6] text-muted">
                {t("separate")}
              </p>
            </aside>
          </div>
        </Container>
      </section>
    </>
  );
}
