import { CTAButton } from "@/components/CTAButton";
import { formatPlanMoney } from "@/lib/plans";
import {
  DEFAULT_REFERRAL_REWARDS_CENTS,
  PLAN_ORDER,
  PREMIUM_PLAN,
  type PlanId,
} from "@/product/saas/plan-catalog";

export type ReferralProgramTeaserCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  youEarn: string;
  giftCard: string;
  cta: string;
  planNames: Record<PlanId, string>;
};

/** Compact public teaser for the gift-card referral program. */
export function ReferralProgramTeaser({
  locale,
  copy,
}: {
  locale: string;
  copy: ReferralProgramTeaserCopy;
}) {
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
        {PLAN_ORDER.map((plan) => {
          const cents = DEFAULT_REFERRAL_REWARDS_CENTS[plan];
          const premium = plan === PREMIUM_PLAN;
          return (
            <li
              key={plan}
              className={
                premium
                  ? "rounded-md bg-navy px-5 py-6 text-white ring-2 ring-orange"
                  : "rounded-md border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-5 py-6"
              }
            >
              <p
                className={
                  premium
                    ? "text-sm text-orange"
                    : "text-sm text-muted"
                }
              >
                {copy.planNames[plan]}
              </p>
              <p
                className={`mt-3 text-[13px] ${
                  premium ? "text-white/65" : "text-secondary"
                }`}
              >
                {copy.youEarn}
              </p>
              <p
                className={`font-heading text-[clamp(28px,3vw,36px)] font-extrabold tracking-[-0.04em] ${
                  premium ? "text-white" : "text-heading"
                }`}
              >
                {formatPlanMoney(cents / 100, locale, 0)}
              </p>
              <p
                className={`mt-1 text-sm ${
                  premium ? "text-white/65" : "text-muted"
                }`}
              >
                {copy.giftCard}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="mt-8">
        <CTAButton href="/referral" variant="ink" size="md">
          {copy.cta}
        </CTAButton>
      </div>
    </div>
  );
}
