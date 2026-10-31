import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReferralShare } from "@/components/app/ReferralShare";
import { formatPlanMoney } from "@/lib/plans";
import { referralUrl } from "@/product/referrals/links";
import { logReferralFailure } from "@/product/referrals/log";
import { getReferralService } from "@/product/referrals/runtime";
import type { ReferrerOverview } from "@/product/referrals/service";
import { canManageBilling } from "@/product/saas/billing-access";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

const CARD = "rounded-md border border-navy/10 bg-white px-5 py-4";
const H2 = "text-sm font-semibold uppercase tracking-[0.06em] text-navy/50";

export default async function AppReferralsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "fr" ? "fr" : "en";
  const t = await getTranslations("referrals.app");
  const plans = await getTranslations("plans");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const header = (
    <header>
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        {t("headline")}
      </h1>
      <p className="mt-2 max-w-[44em] text-navy/70">{t("intro")}</p>
    </header>
  );

  // Rewards and payouts are a billing matter: owners and administrators only.
  if (!canManageBilling(auth.ctx.membership.role) && !auth.ctx.isPlatformAdmin) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className={CARD}>{t("restricted")}</p>
      </div>
    );
  }

  let overview: ReferrerOverview | null = null;
  try {
    overview = await getReferralService().overview(auth.ctx.organization.id);
  } catch (error) {
    logReferralFailure("overview", error);
  }
  if (!overview) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className={CARD} role="alert">
          {t("unavailable")}
        </p>
      </div>
    );
  }

  const money = (cents: number) => formatPlanMoney(cents / 100, lang, 0);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium" }).format(
      new Date(iso),
    );
  const planName = (plan: string) => plans(`names.${plan}`);
  const otherLang = lang === "fr" ? "en" : "fr";
  const link = overview.code ? referralUrl(overview.code, lang) : null;
  const otherLink = overview.code ? referralUrl(overview.code, otherLang) : null;
  const eligibility = overview.eligibility;

  return (
    <div className="flex flex-col gap-8">
      {header}

      <section className={CARD} aria-labelledby="ref-link">
        <h2 id="ref-link" className={H2}>
          {t("linkTitle")}
        </h2>
        {link && otherLink ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-navy/70">{t("linkHelp")}</p>
            <ReferralShare
              link={link}
              otherLink={otherLink}
              labels={{
                linkLabel: t("linkLabel"),
                copy: t("copy"),
                copied: t("copied"),
                copyFailed: t("copyFailed"),
                share: t("share"),
                email: t("shareEmail"),
                sms: t("shareSms"),
                otherLanguage: t("otherLanguage"),
                shareMessage: t("shareMessage", { business: auth.ctx.organization.name, link }),
                emailSubject: t("shareSubject"),
              }}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-navy/70">
            {eligibility.eligible ? t("unavailable") : t(`notEligible.${eligibility.reason}`)}
          </p>
        )}
      </section>

      <section className={CARD} aria-labelledby="ref-rewards">
        <h2 id="ref-rewards" className={H2}>
          {t("rewardsTitle")}
        </h2>
        <p className="mt-2 text-sm text-navy/70">{t("rewardsIntro")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {overview.rewards.map((reward) => (
            <li key={reward.plan} className="rounded-md border border-navy/10 px-4 py-3">
              <p className="text-sm text-navy/70">{t("whenTheyChoose", { plan: planName(reward.plan) })}</p>
              <p className="mt-1 font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
                {reward.earns ? t("giftCardAmount", { amount: money(reward.amountCents) }) : t("noReward")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ref-stats">
        <h2 id="ref-stats" className={H2}>
          {t("statsTitle")}
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              ["signedUp", String(overview.totals.signedUp)],
              ["customers", String(overview.totals.customers)],
              ["pending", money(overview.totals.pendingCents)],
              ["earned", money(overview.totals.earnedCents)],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className={CARD}>
              <dt className="text-sm text-navy/70">{t(`stats.${key}`)}</dt>
              <dd className="mt-1 font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-navy/60">
          {t("statsNote", { sent: money(overview.totals.issuedCents) })}
        </p>
      </section>

      <section className={CARD} aria-labelledby="ref-list">
        <h2 id="ref-list" className={H2}>
          {t("listTitle")}
        </h2>
        {overview.referrals.length === 0 ? (
          <p className="mt-3 text-sm text-navy/70">{t("empty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm text-navy">
              <thead>
                <tr className="border-b border-navy/10 text-navy/60">
                  <th scope="col" className="py-2 pr-4 font-medium">{t("colBusiness")}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t("colSignedUp")}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t("colStatus")}</th>
                  <th scope="col" className="py-2 font-medium">{t("colReward")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.referrals.map((referral) => (
                  <tr key={referral.id} className="border-b border-navy/5 last:border-0">
                    <th scope="row" className="py-2 pr-4 font-medium">{referral.businessName}</th>
                    <td className="py-2 pr-4">{date(referral.registeredAt)}</td>
                    <td className="py-2 pr-4">{t(`referralStatus.${referral.status}`)}</td>
                    <td className="py-2">
                      {referral.reward
                        ? t("rewardCell", {
                            amount: money(referral.reward.amountCents),
                            status: t(`rewardStatus.${referral.reward.status}`),
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overview.history.length > 0 ? (
        <section className={CARD} aria-labelledby="ref-history">
          <h2 id="ref-history" className={H2}>
            {t("historyTitle")}
          </h2>
          <ol className="mt-3 flex flex-col gap-2 text-sm text-navy">
            {overview.history.slice(0, 30).map((entry, index) => (
              <li key={`${entry.at}-${entry.kind}-${index}`} className="flex flex-wrap gap-x-3">
                <time className="text-navy/60" dateTime={entry.at}>
                  {date(entry.at)}
                </time>
                <span>
                  {t(`history.${entry.kind}`, {
                    business: entry.businessName,
                    amount: entry.amountCents ? money(entry.amountCents) : "",
                  })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={CARD} aria-labelledby="ref-rules">
        <h2 id="ref-rules" className={H2}>
          {t("rulesTitle")}
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-navy/80">
          {(["payment", "plan", "once", "review", "excluded", "privacy"] as const).map((rule) => (
            <li key={rule}>{t(`rules.${rule}`, { days: overview.holdDays })}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
