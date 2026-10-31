import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { ReferralCapture } from "@/components/ReferralCapture";
import { ReferralForm } from "@/components/ReferralForm";
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
  const form = await getTranslations("referrals.form");
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

      <section className="relative overflow-hidden bg-navy pt-[clamp(72px,8vw,104px)] pb-[clamp(64px,8vw,96px)]">
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
          {settings.programEnabled ? (
            <a
              href="#refer"
              className="mt-8 inline-flex items-center justify-center rounded-[12px] bg-orange px-6 py-3.5 text-[16px] font-bold tracking-[-0.01em] text-navy shadow-cta transition-colors hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {form("title")} ↓
            </a>
          ) : null}
        </Container>
      </section>

      {!settings.programEnabled ? (
        <section className="bg-paper py-[clamp(56px,7vw,96px)]">
          <Container>
            <p
              className="rounded-md border border-[rgb(var(--ink-rgb)/0.12)] bg-surface px-5 py-4 text-heading"
              role="status"
            >
              {t("paused")}
            </p>
          </Container>
        </section>
      ) : (
        <>
          <section className="bg-paper py-[clamp(56px,7vw,96px)]">
            <Container>
              <h2 className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-heading">
                {t("rewardsTitle")}
              </h2>
              <p className="mt-2 max-w-[40em] text-muted">
                {t("rewardsIntro")}
              </p>
              <ul className="mt-8 grid list-none gap-4 p-0 md:grid-cols-3">
                {PLAN_ORDER.map((plan) => {
                  const cents = rewardAmountCents(settings, plan);
                  const premium = plan === PREMIUM_PLAN;
                  return (
                    <li
                      key={plan}
                      className={
                        premium
                          ? "rounded-lg bg-navy px-6 py-7 text-white shadow-lg ring-2 ring-orange"
                          : "rounded-lg border border-[rgb(var(--ink-rgb)/0.12)] bg-surface px-6 py-7 text-heading"
                      }
                    >
                      <p
                        className={
                          premium ? "text-sm text-orange" : "text-sm text-muted"
                        }
                      >
                        {plans(`kind.${plan}`)}
                      </p>
                      <h3 className="mt-1 font-heading text-xl font-extrabold">
                        {plans(`names.${plan}`)}
                      </h3>
                      <p
                        className={
                          premium
                            ? "mt-5 text-sm text-white/70"
                            : "mt-5 text-sm text-muted"
                        }
                      >
                        {t("youEarn")}
                      </p>
                      <p className="font-heading text-4xl font-extrabold tracking-[-0.03em]">
                        {cents > 0 ? money(cents) : t("noReward")}
                      </p>
                      <p
                        className={
                          premium
                            ? "mt-1 text-sm text-white/70"
                            : "mt-1 text-sm text-muted"
                        }
                      >
                        {cents > 0 ? t("giftCard") : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-sm text-muted">{t("amountsNote")}</p>
            </Container>
          </section>

          <section
            id="refer"
            className="scroll-mt-28 border-y border-[rgb(var(--ink-rgb)/0.08)] bg-surface py-[clamp(56px,7vw,96px)]"
          >
            <Container>
              <h2 className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-heading">
                {form("title")}
              </h2>
              <p className="mt-2 mb-8 max-w-[40em] text-muted">
                {form("intro")}
              </p>
              <ReferralForm />
            </Container>
          </section>
        </>
      )}

      <section className="bg-paper py-[clamp(56px,7vw,96px)]">
        <Container>
          <h2 className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-heading">
            {t("stepsTitle")}
          </h2>
          <ol className="mt-8 grid list-none gap-6 p-0 md:grid-cols-3">
            {(["share", "book", "earn"] as const).map((step, index) => (
              <li key={step} className="flex flex-col gap-2">
                <span className="font-heading text-3xl font-extrabold text-orange">
                  {index + 1}
                </span>
                <h3 className="font-heading text-lg font-bold text-heading">
                  {t(`steps.${step}.title`)}
                </h3>
                <p className="text-muted">{t(`steps.${step}.body`)}</p>
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
              className="inline-flex items-center rounded-md bg-orange px-5 py-3 font-semibold text-navy hover:bg-orange-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              {t("cta")}
            </Link>
            <Link
              href="/app/referrals"
              className="text-sm font-medium text-heading underline underline-offset-2"
            >
              {t("existingCustomer")}
            </Link>
          </div>
        </Container>
      </section>

      <section className="border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface py-[clamp(48px,6vw,80px)]">
        <Container>
          <h2 className="font-heading text-xl font-extrabold tracking-[-0.02em] text-heading">
            {t("rulesTitle")}
          </h2>
          <ul className="mt-4 max-w-[48em] list-disc space-y-2 pl-5 text-secondary">
            {(
              [
                "payment",
                "plan",
                "once",
                "review",
                "excluded",
                "delivery",
                "storage",
              ] as const
            ).map((rule) => (
              <li key={rule}>{t(`rules.${rule}`, { days: settings.holdDays })}</li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
