import { CTAButton } from "@/components/CTAButton";
import { SectionHeading } from "@/components/SectionHeading";

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
          className="tc-card-quiet mt-4 max-w-[42em] px-4 py-3 text-[14.5px] leading-[1.5] text-heading"
        >
          {billingNote}
        </p>
      ) : null}

      <ol className="m-0 mt-[clamp(20px,2.4vw,28px)] grid list-none items-stretch gap-4 p-0 md:grid-cols-2 lg:gap-5">
        {tiers.map((tier, i) => {
          const recommended = i === recommendedIndex;
          return (
            <li
              key={tier.name}
              data-reveal
              className={`flex h-full flex-col p-6 ${
                recommended ? "tc-card-recommended" : "tc-card"
              }`}
            >
              <h3 className="text-card-title text-heading">{tier.name}</h3>
              <p className="mt-3 font-heading text-[clamp(1.6rem,2.4vw,2rem)] font-extrabold leading-none tracking-[-0.035em] text-heading tabular-nums">
                {tier.price}
              </p>
              <p className="mt-2 text-[14.5px] text-muted">{tier.cadence}</p>
              <p className="mt-4 border-t border-[rgb(var(--ink-rgb)/0.08)] pt-3 text-[14.5px] leading-[1.55] text-secondary">
                {tier.idealFor}
              </p>
            </li>
          );
        })}
      </ol>

      <p
        data-reveal
        data-testid="pricing-website-addon"
        className="tc-card-quiet mt-4 px-5 py-3 text-[15px] leading-[1.5] text-heading"
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
          {receptionistCta}
        </CTAButton>
      </div>
    </>
  );
}
