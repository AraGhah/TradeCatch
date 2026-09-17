import { CTAButton } from "@/components/CTAButton";
import { SectionHeading } from "@/components/SectionHeading";

export type PricingPreviewTier = {
  name: string;
  price: string;
  cadence: string;
  idealFor: string;
};

/** Three-step plan ladder on the home page. Full detail lives on /pricing. */
export function PricingPreview({
  eyebrow,
  headline,
  intro,
  tiers,
  cta,
  receptionistCta,
  note,
}: {
  eyebrow: string;
  headline: string;
  intro: string;
  tiers: PricingPreviewTier[];
  cta: string;
  receptionistCta: string;
  note: string;
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

      <ol className="m-0 mt-[clamp(32px,4vw,48px)] grid list-none gap-4 p-0 md:grid-cols-3">
        {tiers.map((tier, i) => {
          const premium = i === tiers.length - 1;
          return (
            <li
              key={tier.name}
              data-reveal
              className={`flex flex-col p-[clamp(22px,2.6vw,30px)] ${
                premium
                  ? "border border-orange/45 bg-surface ring-1 ring-orange/15"
                  : "border border-[rgb(var(--ink-rgb)/0.1)] bg-surface"
              }`}
            >
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 font-heading text-[22px] font-extrabold tracking-[-0.035em] text-heading">
                {tier.name}
              </h3>
              <p className="mt-3 font-heading text-[19px] font-bold tracking-[-0.025em] break-words text-heading">
                {tier.price}
              </p>
              <p className="mt-1 text-[14.5px] text-muted">{tier.cadence}</p>
              <p className="mt-4 border-t border-[rgb(var(--ink-rgb)/0.08)] pt-4 text-[14.5px] leading-[1.55] text-secondary">
                {tier.idealFor}
              </p>
            </li>
          );
        })}
      </ol>

      <div
        data-reveal
        className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center"
      >
        <CTAButton href="/pricing" variant="ink" size="md">
          {cta}
        </CTAButton>
        <CTAButton href="/ai-receptionist" variant="secondary" size="md">
          {receptionistCta} →
        </CTAButton>
      </div>
      <p data-reveal className="mt-5 text-[14px] leading-[1.55] text-muted">
        {note}
      </p>
    </>
  );
}
