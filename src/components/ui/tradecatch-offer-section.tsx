import type { ComponentProps, ReactNode } from "react";
import {
  Banknote,
  CalendarCheck,
  Check,
  ClipboardList,
  PhoneCall,
  Send,
  Wrench,
} from "lucide-react";

import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { cn } from "@/lib/cn";

/**
 * The offer layout shared by Pricing and Rewards: a page header, one record
 * card per offer, and (on Rewards) the numbered process. It holds no prices,
 * amounts or copy of its own; the pages pass in what the plan catalog, the
 * referral settings and the translations say.
 */

const STAGE_ICONS = {
  call: PhoneCall,
  lead: ClipboardList,
  booking: CalendarCheck,
  referral: Send,
  setup: Wrench,
  payout: Banknote,
} as const;

export type OfferStage = {
  icon: keyof typeof STAGE_ICONS;
  label: string;
  /** False: this offer stops before this stage. */
  reached: boolean;
};

export type OfferFeatureGroup = { title: string; items: string[] };

export type TradeCatchOffer = {
  id: string;
  title: string;
  tagline: string;
  description?: string;
  audience?: string;
  badge?: string;
  featured?: boolean;
  /** Caption above the main figure, e.g. "Each month" or "You earn". */
  amountLabel: string;
  /** Already formatted for the visitor's language. */
  amount: string;
  amountSuffix?: string;
  /** A one-time fee, always set apart from the recurring figure above it. */
  oneTimeFee?: { label: string; amount: string; note: string };
  /** Billing disclosures printed with the price. */
  priceNotes?: string[];
  /** The one difference worth calling out, e.g. what the step up costs. */
  highlight?: string;
  /** How far along the job this offer goes. */
  rail: { label: string; unreachedLabel: string; stages: OfferStage[] };
  includesPrevious?: string;
  groups?: OfferFeatureGroup[];
  cta?: { label: string; href: ComponentProps<typeof CTAButton>["href"] };
  /** Small line under the button. */
  footnote?: ReactNode;
};

export type OfferStep = { title: string; description: string };

/** The signature element: a call (or a referral) traced from start to finish. */
function JobRail({
  rail,
  featured,
}: {
  rail: TradeCatchOffer["rail"];
  featured: boolean;
}) {
  const last = rail.stages.reduce(
    (found, stage, index) => (stage.reached ? index : found),
    -1,
  );
  return (
    <ol
      aria-label={rail.label}
      data-testid="offer-rail"
      className="m-0 grid list-none grid-cols-3 p-0"
    >
      {rail.stages.map((stage, index) => {
        const Icon = STAGE_ICONS[stage.icon];
        const next = rail.stages[index + 1];
        return (
          <li
            key={stage.label}
            data-reached={stage.reached}
            className="relative flex flex-col items-center gap-2 text-center"
          >
            {next ? (
              <span
                aria-hidden
                className={cn(
                  "absolute top-[18px] left-[calc(50%+24px)] w-[calc(100%-48px)] border-t",
                  next.reached
                    ? "border-navy/40"
                    : "border-dashed border-[rgb(var(--ink-rgb)/0.24)]",
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border",
                !stage.reached &&
                  "border-dashed border-[rgb(var(--ink-rgb)/0.28)] text-muted",
                stage.reached && "border-navy bg-navy text-white",
                featured && index === last && "border-orange bg-orange !text-navy",
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </span>
            <span
              className={cn(
                "px-1 text-[12.5px] leading-[1.3]",
                stage.reached ? "font-medium text-heading" : "text-muted",
              )}
            >
              {stage.label}
              {stage.reached ? null : (
                <span className="block text-[11.5px]">{rail.unreachedLabel}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function OfferCard({
  offer,
  headingLevel: Heading,
  as: Element,
}: {
  offer: TradeCatchOffer;
  headingLevel: "h2" | "h3";
  as: "article" | "li";
}) {
  const featured = Boolean(offer.featured);
  return (
    <Element
      data-offer={offer.id}
      className={cn(
        // Subgrid keeps header, price, button, rail and list level across both cards.
        "flex min-w-0 flex-col rounded-[var(--radius-lg)] border bg-surface text-heading md:row-span-5 md:grid md:grid-rows-subgrid md:gap-0",
        featured
          ? "border-navy shadow-[0_0_0_1px_var(--color-navy),var(--shadow-card)]"
          : "border-[rgb(var(--ink-rgb)/0.13)]",
      )}
    >
      <div className="px-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Heading className="m-0 font-heading text-[26px] font-extrabold tracking-[-0.03em] text-heading">
            {offer.title}
          </Heading>
          {offer.badge ? (
            <p className="rounded-[var(--radius-sm)] border border-orange/35 bg-orange/10 px-2.5 py-1 text-[12.5px] font-bold text-ember-text">
              {offer.badge}
            </p>
          ) : null}
        </div>
        <p className="mt-1.5 text-[15.5px] leading-[1.45] font-medium text-heading">
          {offer.tagline}
        </p>
      </div>

      <div className="px-5 pt-4 sm:px-7">
        <div className="border-t border-[rgb(var(--ink-rgb)/0.1)] pt-4">
          <p className="m-0 text-[13px] font-medium text-muted">
            {offer.amountLabel}
          </p>
          <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="font-heading text-[clamp(38px,4.4vw,50px)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
              {offer.amount}
            </span>
            {offer.amountSuffix ? (
              <span className="text-[15px] text-muted">{offer.amountSuffix}</span>
            ) : null}
          </p>
        </div>
        {offer.oneTimeFee ? (
          <p
            data-testid="offer-one-time-fee"
            className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--ink-rgb)/0.26)] bg-paper px-3 py-2 text-[14px]"
          >
            <span className="text-secondary">
              {offer.oneTimeFee.label}
              <span className="text-muted"> · {offer.oneTimeFee.note}</span>
            </span>
            <span className="font-bold tabular-nums">
              {offer.oneTimeFee.amount}
            </span>
          </p>
        ) : null}
        {offer.highlight ? (
          <p className="mt-3 border-l-2 border-orange pl-3 text-[14px] leading-[1.45] font-medium">
            {offer.highlight}
          </p>
        ) : null}
        {offer.priceNotes?.map((note) => (
          <p key={note} className="mt-2 text-[13px] leading-[1.5] text-muted">
            {note}
          </p>
        ))}
      </div>

      <div className="px-5 pt-4 sm:px-7 md:self-end">
        {offer.cta ? (
          <CTAButton
            href={offer.cta.href}
            variant={featured ? "ember" : "ink"}
            size="md"
            className="w-full"
          >
            {offer.cta.label}
          </CTAButton>
        ) : null}
        {offer.footnote ? (
          <p className="mt-2 text-center text-[13px] leading-[1.45] text-muted">
            {offer.footnote}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "mt-5 border-t border-[rgb(var(--ink-rgb)/0.1)] px-3 py-4 sm:px-5",
          !offer.groups?.length && "rounded-b-[var(--radius-lg)]",
        )}
      >
        <JobRail rail={offer.rail} featured={featured} />
        {offer.description ? (
          <p className="m-0 mt-4 px-2 text-[14.5px] leading-[1.55] text-secondary">
            {offer.description}
          </p>
        ) : null}
        {offer.audience ? (
          <p className="m-0 mt-1.5 px-2 text-[13.5px] leading-[1.5] text-muted">
            {offer.audience}
          </p>
        ) : null}
      </div>

      {offer.groups?.length ? (
        <div className="border-t border-[rgb(var(--ink-rgb)/0.1)] px-5 pt-4 pb-5 sm:px-7 sm:pb-6">
          {offer.includesPrevious ? (
            <p className="mb-3 text-[14.5px] font-bold">{offer.includesPrevious}</p>
          ) : null}
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            {offer.groups.map((group) => (
              <div key={group.title}>
                <p className="m-0 text-[13px] font-bold text-heading">
                  {group.title}
                </p>
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-[14px] leading-[1.4] text-secondary"
                    >
                      <Check
                        aria-hidden
                        className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal-text"
                        strokeWidth={2.5}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div aria-hidden className="hidden md:block" />
      )}
    </Element>
  );
}

function OfferSteps({
  title,
  steps,
  footer,
}: {
  title: string;
  steps: OfferStep[];
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto mt-10 max-w-5xl border-t border-[rgb(var(--ink-rgb)/0.14)] pt-7 md:mt-14 md:pt-10">
      <h2 className="m-0 font-heading text-2xl font-extrabold tracking-[-0.03em] text-heading">
        {title}
      </h2>
      <ol className="mt-5 grid list-none overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--ink-rgb)/0.13)] bg-surface p-0 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-4 border-t border-[rgb(var(--ink-rgb)/0.1)] p-5 first:border-t-0 md:flex-col md:gap-3 md:border-t-0 md:border-l md:first:border-l-0"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-orange/40 bg-orange/10 text-[14px] font-extrabold text-ember-text tabular-nums"
            >
              {index + 1}
            </span>
            <div>
              <h3 className="m-0 font-heading text-[17px] font-bold text-heading">
                {step.title}
              </h3>
              <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {footer ? <div className="mt-6">{footer}</div> : null}
    </div>
  );
}

export function TradeCatchOfferSection({
  mode,
  eyebrow,
  title,
  description,
  headerExtra,
  cardsHeading,
  offers,
  afterOffers,
  steps,
}: {
  /** Pricing cards are the page's articles; reward cards are a list under their own heading. */
  mode: "pricing" | "referral";
  eyebrow: string;
  title: string;
  description: string;
  /** Billing banner, header buttons or the "you were referred" notice. */
  headerExtra?: ReactNode;
  cardsHeading?: { title: string; intro: string };
  offers: TradeCatchOffer[];
  afterOffers?: ReactNode;
  steps?: { title: string; items: OfferStep[]; footer?: ReactNode };
}) {
  const referral = mode === "referral";
  const Grid = referral ? "ul" : "div";
  return (
    <section
      data-offer-mode={mode}
      className="bg-paper pt-[clamp(24px,2.4vw,34px)] pb-[clamp(36px,5vw,64px)]"
    >
      <Container>
        <header className="mx-auto max-w-3xl text-center">
          <p className="m-0 text-[14px] font-bold text-ember-text">{eyebrow}</p>
          <h1 className="text-page-hero mt-3 text-heading">{title}</h1>
          <p className="mx-auto mt-3 max-w-[38em] text-[clamp(16px,1.35vw,18px)] leading-[1.55] text-secondary">
            {description}
          </p>
          {headerExtra}
        </header>

        {cardsHeading && offers.length ? (
          <div className="mx-auto mt-9 max-w-5xl md:mt-12">
            <h2 className="m-0 font-heading text-2xl font-extrabold tracking-[-0.03em] text-heading">
              {cardsHeading.title}
            </h2>
            <p className="mt-2 max-w-[46em] text-[15px] leading-[1.55] text-muted">
              {cardsHeading.intro}
            </p>
          </div>
        ) : null}

        {offers.length ? (
          <Grid
            className={cn(
              "mx-auto grid max-w-5xl list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 md:gap-x-5 md:gap-y-0",
              cardsHeading ? "mt-5" : "mt-6",
            )}
          >
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                headingLevel={referral ? "h3" : "h2"}
                as={referral ? "li" : "article"}
              />
            ))}
          </Grid>
        ) : null}

        {afterOffers ? <div className="mx-auto mt-4 max-w-5xl">{afterOffers}</div> : null}

        {steps ? (
          <OfferSteps
            title={steps.title}
            steps={steps.items}
            footer={steps.footer}
          />
        ) : null}
      </Container>
    </section>
  );
}
