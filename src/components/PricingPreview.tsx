import { CTAButton } from "@/components/CTAButton";
import { SectionHeading } from "@/components/SectionHeading";
import { StaggerGroup, StaggerItem } from "@/components/motion/StaggerGroup";

export type PricingPreviewTier = {
  name: string;
  price: string;
  cadence: string;
  idealFor: string;
};

/** The two plans on the home page. Full detail lives on /pricing. */
export function PricingPreview({
  eyebrow,
  headline,
  intro,
  tiers,
  cta,
  receptionistCta,
  note,
  billingNote,
  recommendedIndex = 1,
}: {
  eyebrow: string;
  headline: string;
  intro: string;
  tiers: PricingPreviewTier[];
  cta: string;
  receptionistCta: string;
  note: string;
  billingNote?: string;
  /** Professional (the second plan) is the one highlighted. */
  recommendedIndex?: number;
}) {
  return (
    <>
      <div data-reveal>
        <SectionHeading
          align="left"
          eyebrow={eyebrow}
          title={headline}
          intro={intro}
          className="max-w-[42em]"
        />
      </div>

      {billingNote ? (
        <p
          data-reveal
          className="mt-4 max-w-[42em] rounded-[12px] border border-orange/30 bg-[rgba(228,118,43,0.08)] px-4 py-2.5 text-[14.5px] leading-[1.5] text-heading"
        >
          {billingNote}
        </p>
      ) : null}

      <StaggerGroup
        as="ol"
        stagger={0.12}
        className="m-0 mt-[clamp(20px,2.4vw,28px)] grid list-none items-stretch gap-4 p-0 md:grid-cols-2 lg:gap-5"
      >
        {tiers.map((tier, i) => {
          const premium = i === tiers.length - 1;
          const recommended = i === recommendedIndex;
          return (
            <StaggerItem
              as="li"
              key={tier.name}
              className={`flex h-full flex-col rounded-[14px] p-5 transition-[translate,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:shadow-card-hover ${
                premium || recommended
                  ? "animate-tc-glow border border-orange/45 bg-surface ring-1 ring-orange/15"
                  : "border border-[rgb(var(--ink-rgb)/0.1)] bg-surface hover:border-[rgb(var(--ink-rgb)/0.2)]"
              }`}
            >
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 font-heading text-[21px] font-extrabold tracking-[-0.035em] text-heading">
                {tier.name}
              </h3>
              <p
                className={`mt-2 font-heading text-[clamp(26px,2.6vw,32px)] font-extrabold leading-[0.95] tracking-[-0.04em] break-words ${
                  premium || recommended ? "text-orange" : "text-heading"
                }`}
              >
                {tier.price}
              </p>
              <p className="mt-1.5 text-[14.5px] text-muted">{tier.cadence}</p>
              <p className="mt-3 border-t border-[rgb(var(--ink-rgb)/0.08)] pt-3 text-[14.5px] leading-[1.55] text-secondary">
                {tier.idealFor}
              </p>
            </StaggerItem>
          );
        })}
      </StaggerGroup>

      <p
        data-reveal
        data-testid="pricing-website-addon"
        className="mt-4 rounded-[14px] border border-dashed border-[rgb(var(--ink-rgb)/0.22)] bg-paper px-5 py-3 text-[15px] leading-[1.5] text-heading"
      >
        {note}
      </p>

      <div
        data-reveal
        className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
      >
        <CTAButton href="/pricing" variant="ink" size="md">
          {cta}
        </CTAButton>
        <CTAButton href="/receptionist" variant="secondary" size="md">
          {receptionistCta} →
        </CTAButton>
      </div>
    </>
  );
}
