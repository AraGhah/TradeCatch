import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { ReferralCapture } from "@/components/ReferralCapture";
import { ReferralForm } from "@/components/ReferralForm";
import {
  TradeCatchOfferSection,
  type TradeCatchOffer,
} from "@/components/ui/tradecatch-offer-section";
import { CTAButton } from "@/components/CTAButton";
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
import { PLAN_ORDER, PREMIUM_PLAN } from "@/product/saas/plan-catalog";
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

  // One card per plan on sale; the amounts are the administrator's current settings.
  const flow = t.raw("flow") as Record<"label" | "referred" | "paid" | "reward" | "unavailable", string>;
  const offers: TradeCatchOffer[] = settings.programEnabled
    ? PLAN_ORDER.map((plan) => {
        const cents = rewardAmountCents(settings, plan);
        return {
          id: plan,
          title: plans(`names.${plan}`),
          tagline: plans(`kind.${plan}`),
          featured: plan === PREMIUM_PLAN,
          amountLabel: t("youEarn"),
          amount: cents > 0 ? money(cents) : t("noReward"),
          amountSuffix: cents > 0 ? t("giftCard") : undefined,
          rail: {
            label: flow.label,
            unreachedLabel: flow.unavailable,
            stages: [
              { icon: "referral", label: flow.referred, reached: true },
              { icon: "setup", label: flow.paid, reached: true },
              { icon: "payout", label: flow.reward, reached: cents > 0 },
            ],
          },
          cta: { label: form("title"), href: "#refer" },
        };
      })
    : [];

  return (
    <>
      <ReferralCapture code={codeIsLive ? code : null} />

      <TradeCatchOfferSection
        mode="referral"
        eyebrow={t("eyebrow")}
        title={t("headline", amounts)}
        description={t("intro", amounts)}
        headerExtra={
          <>
            {codeIsLive ? (
              <p
                className="mx-auto mt-5 max-w-[36em] rounded-[var(--radius-md)] border border-orange/40 bg-orange/10 px-4 py-3 text-[15px] text-heading"
                role="status"
              >
                {t("referredBanner")}
              </p>
            ) : null}
            {settings.programEnabled ? (
              <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <a
                  href={getLinkHref}
                  data-testid="referral-get-link-cta"
                  className="inline-flex min-h-12 items-center justify-center rounded-[var(--radius-md)] bg-orange px-6 py-3.5 text-[15px] font-bold text-navy shadow-cta transition-colors hover:bg-orange-dark"
                >
                  {t("getLink")}
                </a>
                <CTAButton href="#refer" variant="ghost">
                  {form("title")} ↓
                </CTAButton>
              </div>
            ) : (
              <p
                className="mx-auto mt-6 max-w-[36em] rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.14)] bg-surface px-5 py-4 text-heading"
                role="status"
              >
                {t("paused")}
              </p>
            )}
          </>
        }
        cardsHeading={{ title: t("rewardsTitle"), intro: t("rewardsIntro", amounts) }}
        offers={offers}
        afterOffers={
          settings.programEnabled ? (
            <>
              {bonusCents > 0 ? (
                <div
                  data-testid="referral-website-bonus"
                  className="flex flex-col gap-x-6 gap-y-2 rounded-[var(--radius-lg)] border border-dashed border-orange/60 bg-surface px-5 py-4 sm:flex-row sm:items-center sm:px-7"
                >
                  <p className="m-0 shrink-0 font-heading text-[34px] leading-none font-extrabold tracking-[-0.04em] text-heading tabular-nums">
                    + {money(bonusCents)}
                  </p>
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 font-heading text-[17px] font-bold text-heading">
                      {t("bonusTitle")}
                    </h3>
                    <p className="m-0 mt-1 text-[14px] leading-[1.45] text-muted">
                      {t("bonusLabel")} · {t("giftCard")}
                    </p>
                  </div>
                </div>
              ) : null}
              <p className="mt-3 text-[14.5px] font-bold text-heading">
                {t("maxNote", amounts)}
              </p>
              <p className="mt-1 text-[13.5px] text-muted">{t("amountsNote")}</p>
            </>
          ) : null
        }
        steps={{
          title: t("stepsTitle"),
          items: (["share", "book", "earn"] as const).map((step) => ({
            title: t(`steps.${step}.title`),
            description: t(`steps.${step}.body`),
          })),
          footer: (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
              <CTAButton
                href={
                  codeIsLive && code
                    ? { pathname: "/book-audit", query: { ref: code } }
                    : "/book-audit"
                }
                variant="ink"
              >
                {t("cta")}
              </CTAButton>
              <a
                href={getLinkHref}
                className="text-sm font-medium text-heading underline underline-offset-2"
              >
                {t("existingCustomer")}
              </a>
            </div>
          ),
        }}
      />

      {settings.programEnabled ? (
        <section
          id="refer"
          className="scroll-mt-28 border-t border-[rgb(var(--ink-rgb)/0.08)] bg-surface py-[clamp(36px,5vw,64px)]"
        >
          <Container>
            <div className="mx-auto max-w-5xl">
              <h2 className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-heading">
                {form("title")}
              </h2>
              <p className="mt-2 mb-6 max-w-[40em] text-muted">{form("intro")}</p>
              <ReferralForm />
            </div>
          </Container>
        </section>
      ) : null}

      <section className="border-t border-[rgb(var(--ink-rgb)/0.08)] bg-paper py-[clamp(32px,4vw,56px)]">
        <Container>
          <div className="mx-auto max-w-5xl">
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
              <li key={rule}>
                {t(`rules.${rule}`, { days: settings.holdDays, ...amounts })}
              </li>
            ))}
          </ul>
          </div>
        </Container>
      </section>
    </>
  );
}
