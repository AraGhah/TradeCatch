import { CTAButton } from "@/components/CTAButton";
import { formatPlanMoney } from "@/lib/plans";
import { ADD_ONS } from "@/product/saas/plan-catalog";

export type WebsiteBuilderAddOnCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  priceNote: string;
  schedulePending: string;
  availableOn: string;
  neverIncluded: string;
  cta?: string;
};

/** Optional Website Builder add-on — never implied as included in any plan. */
export function WebsiteBuilderAddOn({
  locale,
  copy,
}: {
  locale: string;
  copy: WebsiteBuilderAddOnCopy;
}) {
  const addOn = ADD_ONS.websiteBuilder;
  const price = formatPlanMoney(addOn.priceCad, locale);

  return (
    <div className="relative overflow-hidden border border-orange/35 bg-navy px-[clamp(24px,3vw,44px)] py-[clamp(32px,4vw,52px)] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-0 h-56 w-56 rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle, rgba(228,118,43,0.45) 0%, transparent 70%)",
        }}
      />
      <p className="relative text-[13px] font-medium text-orange">{copy.eyebrow}</p>
      <h2 className="relative mt-3 max-w-[16em] font-heading text-[clamp(26px,3.2vw,40px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-white">
        {copy.title}
      </h2>
      <p className="relative mt-4 max-w-[42em] text-[16px] leading-[1.6] text-white/70">
        {copy.intro}
      </p>
      <p className="relative mt-7 font-heading text-[clamp(32px,3.4vw,48px)] font-extrabold tracking-[-0.045em] text-orange">
        {price}
      </p>
      <p className="relative mt-2 max-w-[40em] text-[14.5px] text-white/65">
        {copy.priceNote}
        {addOn.billingSchedule ? null : ` ${copy.schedulePending}`}
      </p>
      <ul className="relative mt-5 m-0 list-none space-y-2 p-0 text-[14.5px] leading-[1.55] text-white/75">
        <li>{copy.availableOn}</li>
        <li>{copy.neverIncluded}</li>
      </ul>
      {copy.cta ? (
        <div className="relative mt-8">
          <CTAButton href="/book-audit" variant="primary" size="md">
            {copy.cta}
          </CTAButton>
        </div>
      ) : null}
    </div>
  );
}
