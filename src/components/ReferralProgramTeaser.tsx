import { CTAButton } from "@/components/CTAButton";
import { formatPlanMoney } from "@/lib/plans";
import {
  DEFAULT_REFERRAL_REWARDS_CENTS,
  PLAN_ORDER,
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

      <ul className="mt-8 grid list-none gap-4 p-0 md:grid-cols-3">
        {PLAN_ORDER.map((plan) => (
          <li
            key={plan}
            className="rounded-md border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-5 py-6"
          >
            <p className="text-sm text-muted">{copy.planNames[plan]}</p>
            <p className="mt-3 text-[13px] text-secondary">{copy.youEarn}</p>
            <p className="font-heading text-[clamp(28px,3vw,36px)] font-extrabold tracking-[-0.04em] text-heading">
              {money(DEFAULT_REFERRAL_REWARDS_CENTS[plan])}
            </p>
            <p className="mt-1 text-sm text-muted">{copy.giftCard}</p>
          </li>
        ))}
        <li
          data-testid="referral-website-bonus"
          className="rounded-md border border-orange/50 bg-surface px-5 py-6 ring-1 ring-orange/20"
        >
          <p className="text-sm text-muted">{copy.bonusTitle}</p>
          <p className="mt-3 text-[13px] text-secondary">{copy.youEarn}</p>
          <p className="font-heading text-[clamp(28px,3vw,36px)] font-extrabold tracking-[-0.04em] text-heading">
            + {money(REFERRAL_WEBSITE_BONUS_CENTS)}
          </p>
          <p className="mt-1 text-sm text-muted">{copy.bonusLabel}</p>
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
