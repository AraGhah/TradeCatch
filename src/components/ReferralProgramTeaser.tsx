import { CTAButton } from "@/components/CTAButton";
import { cn } from "@/lib/cn";
import { formatPlanMoney } from "@/lib/plans";
import {
  DEFAULT_REFERRAL_REWARDS_CENTS,
  PLAN_ORDER,
  PREMIUM_PLAN,
  REFERRAL_WEBSITE_BONUS_CENTS,
  type PlanId,
} from "@/product/saas/plan-catalog";

export type ReferralProgramTeaserCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  youEarn: string;
  giftCard: string;
  /** Label above the website-service bonus, e.g. "Website service bonus". */
  bonusTitle: string;
  /** Short line under the bonus amount. */
  bonusLabel: string;
  /** Already formatted, e.g. "The most one referral can earn is $100 CAD." */
  maxNote: string;
  cta: string;
  planNames: Record<PlanId, string>;
};

/**
 * Compact public teaser for the referral program: the same reward for either
 * plan, a bonus when the referred customer also buys the website service, and
 * the most one referral can earn. Amounts come from the plan catalog, which is
 * also what seeds the admin referral settings, so the teaser and the program
 * rules cannot disagree.
 */
export function ReferralProgramTeaser({
  locale,
  copy,
}: {
  locale: string;
  copy: ReferralProgramTeaserCopy;
}) {
  const money = (cents: number) => formatPlanMoney(cents / 100, locale, 0);

  return (
    <div>
      <p className="text-[13px] font-medium text-ember-text">{copy.eyebrow}</p>
      <h2 className="mt-3 max-w-[18em] font-heading text-[clamp(26px,3vw,38px)] font-extrabold leading-[1.06] tracking-[-0.038em] text-heading">
        {copy.title}
      </h2>
      <p className="mt-4 max-w-[46em] text-[16px] leading-[1.6] text-muted">
        {copy.intro}
      </p>

      {/* The same record styling as the Rewards page: matched rewards, then the add-on. */}
      <ul className="mt-6 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {PLAN_ORDER.map((plan) => (
          <li
            key={plan}
            className={cn(
              "rounded-[var(--radius-lg)] border bg-surface px-5 py-4",
              plan === PREMIUM_PLAN
                ? "border-navy"
                : "border-[rgb(var(--ink-rgb)/0.13)]",
            )}
          >
            <p className="m-0 font-heading text-[18px] font-extrabold text-heading">
              {copy.planNames[plan]}
            </p>
            <p className="m-0 mt-3 text-[13px] font-medium text-muted">{copy.youEarn}</p>
            <p className="m-0 flex flex-wrap items-baseline gap-x-2">
              <span className="font-heading text-[clamp(30px,3vw,38px)] font-extrabold tracking-[-0.04em] text-heading tabular-nums">
                {money(DEFAULT_REFERRAL_REWARDS_CENTS[plan])}
              </span>
              <span className="text-sm text-muted">{copy.giftCard}</span>
            </p>
          </li>
        ))}
        <li
          data-testid="referral-website-bonus"
          className="rounded-[var(--radius-lg)] border border-dashed border-orange/60 bg-surface px-5 py-4 sm:col-span-2 lg:col-span-1"
        >
          <p className="m-0 font-heading text-[18px] font-extrabold text-heading">
            {copy.bonusTitle}
          </p>
          <p className="m-0 mt-3 text-[13px] font-medium text-muted">{copy.youEarn}</p>
          <p className="m-0 font-heading text-[clamp(30px,3vw,38px)] font-extrabold tracking-[-0.04em] text-heading tabular-nums">
            + {money(REFERRAL_WEBSITE_BONUS_CENTS)}
          </p>
          <p className="m-0 text-sm text-muted">{copy.bonusLabel}</p>
        </li>
      </ul>

      <p className="mt-4 text-sm font-medium text-heading">
        {copy.maxNote}
      </p>

      <div className="mt-6">
        <CTAButton href="/referral" variant="ink" size="md">
          {copy.cta}
        </CTAButton>
      </div>
    </div>
  );
}
