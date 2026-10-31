import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { ReferralCapture } from "@/components/ReferralCapture";
import { Link } from "@/i18n/navigation";
import { formatPlanMoney } from "@/lib/plans";
import { buildMetadata } from "@/lib/seo";
import { normalizeReferralCode } from "@/product/referrals/code";
import { logReferralFailure } from "@/product/referrals/log";
import {
  DEFAULT_REFERRAL_SETTINGS,
  rewardAmountCents,
  type ReferralSettings,
} from "@/product/referrals/model";
import { getReferralServiceReady } from "@/product/referrals/runtime";
import { PLAN_ORDER, PREMIUM_PLAN } from "@/product/saas/plan-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "referrals.public" });
  return buildMetadata({
    locale,
    pathname: "/referral",
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

export default async function ReferralPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const lang = locale === "fr" ? "fr" : "en";
  const t = await getTranslations("referrals.public");
  const plans = await getTranslations("plans");

  const rawRef = Array.isArray(query.ref) ? query.ref[0] : query.ref;
  const code = normalizeReferralCode(rawRef);

  // The page must render even if the referral store is unreachable: fall back
  // to the published defaults and treat the link as unverified. Soft failures
  // must not surface as a Next.js console-error overlay.
  let settings: ReferralSettings = DEFAULT_REFERRAL_SETTINGS;
  let codeIsLive = false;
  try {
    const service = await getReferralServiceReady();
    settings = await service.getSettings();
    codeIsLive = code ? await service.isCodeValid(code) : false;
  } catch (error) {
    logReferralFailure("landing page data", error);
    settings = DEFAULT_REFERRAL_SETTINGS;
    codeIsLive = false;
  }

  const money = (cents: number) => formatPlanMoney(cents / 100, lang, 0);

  return (
    <>
      <ReferralCapture code={codeIsLive ? code : null} />

      <section className="relative overflow-hidden bg-navy pt-[clamp(80px,9vw,110px)] pb-[clamp(72px,9vw,110px)]">
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
          {codeIsLive ? (
            <p
              className="mt-6 max-w-[36em] rounded-md border border-white/20 bg-white/10 px-4 py-3 text-[15px] text-white"
              role="status"
            >
              {t("referredBanner")}
            </p>
          ) : null}
        </Container>
      </section>

      <section className="bg-paper py-[clamp(56px,7vw,96px)]">
        <Container>
          {!settings.programEnabled ? (
            <p
              className="rounded-md border border-navy/10 bg-white px-5 py-4 text-navy"
              role="status"
            >
              {t("paused")}
            </p>
          ) : (
            <>
              <h2 className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-navy">
                {t("rewardsTitle")}
              </h2>
              <p className="mt-2 max-w-[40em] text-navy/70">{t("rewardsIntro")}</p>
              <ul className="mt-8 grid gap-4 md:grid-cols-3">
                {PLAN_ORDER.map((plan) => {
                  const cents = rewardAmountCents(settings, plan);
                  const premium = plan === PREMIUM_PLAN;
                  return (
                    <li
                      key={plan}
                      className={
                        premium
                          ? "rounded-lg bg-navy px-6 py-7 text-white shadow-lg ring-2 ring-orange"
                          : "rounded-lg border border-navy/10 bg-white px-6 py-7 text-navy"
                      }
                    >
                      <p className={premium ? "text-sm text-orange" : "text-sm text-navy/60"}>
                        {plans(`kind.${plan}`)}
                      </p>
                      <h3 className="mt-1 font-heading text-xl font-extrabold">
                        {plans(`names.${plan}`)}
                      </h3>
                      <p
                        className={
                          premium ? "mt-5 text-sm text-white/70" : "mt-5 text-sm text-navy/70"
                        }
                      >
                        {t("youEarn")}
                      </p>
                      <p className="font-heading text-4xl font-extrabold tracking-[-0.03em]">
                        {cents > 0 ? money(cents) : t("noReward")}
                      </p>
                      <p
                        className={
                          premium ? "mt-1 text-sm text-white/70" : "mt-1 text-sm text-navy/70"
                        }
                      >
                        {cents > 0 ? t("giftCard") : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-sm text-navy/60">{t("amountsNote")}</p>
            </>
          )}
        </Container>
      </section>

      <section className="bg-white py-[clamp(56px,7vw,96px)]">
        <Container>
          <h2 className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-navy">
            {t("stepsTitle")}
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {(["share", "book", "earn"] as const).map((step, index) => (
              <li key={step} className="flex flex-col gap-2">
                <span className="font-heading text-3xl font-extrabold text-orange">
                  {index + 1}
                </span>
                <h3 className="font-heading text-lg font-bold text-navy">
                  {t(`steps.${step}.title`)}
                </h3>
                <p className="text-navy/70">{t(`steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href={
                codeIsLive && code
                  ? { pathname: "/book-audit", query: { ref: code } }
                  : "/book-audit"
              }
              className="inline-flex items-center rounded-md bg-orange px-5 py-3 font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2"
            >
              {t("cta")}
            </Link>
            <Link href="/app/referrals" className="text-sm font-medium text-navy underline">
              {t("existingCustomer")}
            </Link>
          </div>
        </Container>
      </section>

      <section className="bg-paper py-[clamp(48px,6vw,80px)]">
        <Container>
          <h2 className="font-heading text-xl font-extrabold tracking-[-0.02em] text-navy">
            {t("rulesTitle")}
          </h2>
          <ul className="mt-4 max-w-[48em] list-disc space-y-2 pl-5 text-navy/80">
            {(["payment", "plan", "once", "review", "excluded", "delivery", "storage"] as const).map(
              (rule) => (
                <li key={rule}>{t(`rules.${rule}`, { days: settings.holdDays })}</li>
              ),
            )}
          </ul>
        </Container>
      </section>
    </>
  );
}
