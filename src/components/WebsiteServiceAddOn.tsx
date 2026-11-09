import { CTAButton } from "@/components/CTAButton";

export type WebsiteServiceAddOnCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  /** "Starting at $349 CAD" — the number comes from the plan catalog (tests enforce it). */
  price: string;
  priceNote: string;
  availableOn: string;
  neverIncluded: string;
  includesTitle: string;
  includes: string[];
  cta: string;
};

/**
 * Done-for-You Website Service. Sits directly under the three plans so it is
 * found before the enterprise block and the FAQs. It is a separate one-time
 * project: nothing here adds to a subscription, and the CTA only opens a
 * request form (the final scope and price are confirmed before any payment).
 */
export function WebsiteServiceAddOn({ copy }: { copy: WebsiteServiceAddOnCopy }) {
  return (
    <section
      id="website-service"
      aria-labelledby="website-service-title"
      className="relative scroll-mt-28 overflow-hidden border border-orange/35 bg-navy px-[clamp(18px,3vw,36px)] py-[clamp(20px,3.2vw,40px)] text-white"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-0 h-56 w-56 rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle, rgba(228,118,43,0.45) 0%, transparent 70%)",
        }}
      />
      <div className="relative grid gap-x-8 gap-y-4 md:grid-cols-[1.15fr_0.85fr] lg:gap-x-14">
        <div>
          <p className="text-[13px] font-medium text-orange">{copy.eyebrow}</p>
          <h2
            id="website-service-title"
            className="mt-2 max-w-[16em] font-heading text-[clamp(24px,3vw,36px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-white"
          >
            {copy.title}
          </h2>
          <p className="mt-2 max-w-[42em] text-[15.5px] leading-[1.55] text-white/75">
            {copy.intro}
          </p>
          <p className="mt-3 font-heading text-[clamp(30px,3.2vw,42px)] font-extrabold tracking-[-0.045em] text-orange">
            {copy.price}
          </p>
          <p className="mt-1.5 max-w-[40em] text-[14.5px] leading-[1.5] text-white/72">
            {copy.priceNote}
          </p>
          <ul className="mt-2 m-0 list-none space-y-1 p-0 text-[14.5px] leading-[1.5] text-white/78">
            <li>{copy.availableOn}</li>
            <li>{copy.neverIncluded}</li>
          </ul>
          <div className="mt-4">
            <CTAButton href="/website-request" variant="primary" size="md">
              {copy.cta}
            </CTAButton>
          </div>
        </div>

        <div className="border-t border-white/15 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-8 lg:pl-10">
          <p className="text-[12px] font-semibold tracking-[0.1em] text-white/55 uppercase">
            {copy.includesTitle}
          </p>
          <ul className="mt-2 m-0 flex list-none flex-col p-0">
            {copy.includes.map((item) => (
              <li
                key={item}
                className="border-t border-white/12 py-2 text-[15px] leading-[1.45] text-white/85 first:border-t-0 first:pt-0"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
