import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { ReferralCapture } from "@/components/ReferralCapture";
import { ReferralForm } from "@/components/ReferralForm";
import { Link } from "@/i18n/navigation";
import { getPathname } from "@/i18n/pathname";
import { formatPlanMoney } from "@/lib/plans";
import { buildMetadata } from "@/lib/seo";
import { normalizeReferralCode } from "@/product/referrals/code";
import { logReferralFailure } from "@/product/referrals/log";
import {
  DEFAULT_REFERRAL_SETTINGS,
  rewardAmountCents,
  websiteBonusAmountCents,
  type ReferralSettings,
} from "@/product/referrals/model";
import { getReferralServiceReady } from "@/product/referrals/runtime";
import { PLAN_ORDER } from "@/product/saas/plan-catalog";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

/** The three amounts the copy quotes, formatted for the visitor's language. */
function referralAmounts(settings: ReferralSettings, locale: string) {
  const money = (cents: number) =>
    formatPlanMoney(cents / 100, locale === "fr" ? "fr" : "en", 0);
  const planCents = Math.max(
    ...PLAN_ORDER.map((plan) => rewardAmountCents(settings, plan)),
  );
  const bonusCents = websiteBonusAmountCents(settings);
  return {
    // The reward follows the plan the referred business chooses.
    essentialReward: money(rewardAmountCents(settings, "essential")),
    professionalReward: money(rewardAmountCents(settings, "professional")),
    bonus: money(bonusCents),
    max: money(planCents + bonusCents),
  };
}

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
    description: t("metaDescription", referralAmounts(DEFAULT_REFERRAL_SETTINGS, locale)),
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

  // "Get your link": straight to the dashboard when signed in, otherwise through
  // sign-in, which brings them back to it. The link itself is made there.
  let signedIn = false;
  try {
    signedIn = (await requireTenantContext()).ok;
  } catch {
    signedIn = false;
  }
  const dashboardPath = getPathname({ href: "/app/referrals", locale: lang });
  const getLinkHref = signedIn
    ? dashboardPath
    : `${getPathname({ href: "/login", locale: lang })}?next=${encodeURIComponent(dashboardPath)}`;

  const money = (cents: number) => formatPlanMoney(cents / 100, lang, 0);
  const amounts = referralAmounts(settings, lang);
  const bonusCents = websiteBonusAmountCents(settings);

  return (
    <>
      <ReferralCapture code={codeIsLive ? code : null} />

      <section className="relative overflow-hidden bg-navy pt-[clamp(44px,5.4vw,72px)] pb-[clamp(40px,5vw,64px)]">
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
            {t("headline", amounts)}
          </h1>
          <p className="mt-5 max-w-[36em] text-[clamp(16px,1.35vw,18px)] leading-[1.6] text-white/70">
            {t("intro", amounts)}
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
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={getLinkHref}
                data-testid="referral-get-link-cta"
                className="inline-flex items-center justify-center rounded-[12px] bg-orange px-6 py-3.5 text-[16px] font-bold tracking-[-0.01em] text-navy shadow-cta transition-colors hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {t("getLink")}
              </a>
              <a
                href="#refer"
                className="inline-flex items-center justify-center rounded-[12px] border border-white/25 px-6 py-3.5 text-[16px] font-semibold tracking-[-0.01em] text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {form("title")} ↓
              </a>
            </div>
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
                {t("rewardsIntro", amounts)}
              </p>
              <ul className="mt-8 grid list-none gap-4 p-0 md:grid-cols-3">
                {PLAN_ORDER.map((plan) => {
                  const cents = rewardAmountCents(settings, plan);
                  return (
                    <li
                      key={plan}
                      className="rounded-lg border border-[rgb(var(--ink-rgb)/0.12)] bg-surface px-6 py-7 text-heading"
                    >
                      <p className="text-sm text-muted">{plans(`kind.${plan}`)}</p>
                      <h3 className="mt-1 font-heading text-xl font-extrabold">
                        {plans(`names.${plan}`)}
                      </h3>
                      <p className="mt-5 text-sm text-muted">{t("youEarn")}</p>
                      <p className="font-heading text-4xl font-extrabold tracking-[-0.03em]">
                        {cents > 0 ? money(cents) : t("noReward")}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {cents > 0 ? t("giftCard") : ""}
                      </p>
                    </li>
                  );
                })}
                {bonusCents > 0 ? (
                  <li
                    data-testid="referral-website-bonus"
                    className="rounded-lg border border-orange/50 bg-surface px-6 py-7 text-heading ring-1 ring-orange/20"
                  >
                    <p className="text-sm text-muted">{t("bonusLabel")}</p>
                    <h3 className="mt-1 font-heading text-xl font-extrabold">
                      {t("bonusTitle")}
                    </h3>
                    <p className="mt-5 text-sm text-muted">{t("bonusPlus")}</p>
                    <p className="font-heading text-4xl font-extrabold tracking-[-0.03em]">
                      + {money(bonusCents)}
                    </p>
                    <p className="mt-1 text-sm text-muted">{t("giftCard")}</p>
                  </li>
                ) : null}
              </ul>
              <p className="mt-4 text-sm font-medium text-heading">
                {t("maxNote", amounts)}
              </p>
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
            <a
              href={getLinkHref}
              className="text-sm font-medium text-heading underline underline-offset-2"
            >
              {t("existingCustomer")}
            </a>
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
