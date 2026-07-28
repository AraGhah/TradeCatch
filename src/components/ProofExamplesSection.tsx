import { IllustrativeBadge } from "@/components/IllustrativeBadge";
import { TechnicianAlertCard } from "@/components/TechnicianAlertCard";
import { QuoteFollowUpTimeline } from "@/components/QuoteFollowUpTimeline";
import { CTAButton } from "@/components/CTAButton";

type QuoteStep = { day: string; title: string; body: string };

type AlertCopy = {
  badge: string;
  title: string;
  fromLabel: string;
  jobLabel: string;
  addressLabel: string;
  urgencyLabel: string;
  from: string;
  job: string;
  address: string;
  urgency: string;
  ctaLabel: string;
};

type SmsCopy = {
  badge: string;
  title: string;
  lines: { who: "system" | "customer" | "event"; text: string }[];
};

export function ProofExamplesSection({
  eyebrow,
  headline,
  intro,
  illustrativeLabel,
  sms,
  alert,
  quoteHeadline,
  quoteBadge,
  quoteSteps,
  demoCta,
  onePagerCta,
}: {
  eyebrow: string;
  headline: string;
  intro: string;
  illustrativeLabel: string;
  sms: SmsCopy;
  alert: AlertCopy;
  quoteHeadline: string;
  quoteBadge: string;
  quoteSteps: QuoteStep[];
  demoCta: string;
  onePagerCta: string;
}) {
  return (
    <div data-reveal>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-ember-text">
          {eyebrow}
        </p>
        <IllustrativeBadge label={illustrativeLabel} />
      </div>
      <h2 className="mt-3 max-w-[min(100%,36rem)] font-heading text-[clamp(28px,3.4vw,44px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-navy">
        {headline}
      </h2>
      <p className="mt-4 max-w-[40em] text-[16.5px] leading-[1.65] text-muted">
        {intro}
      </p>

      <div
        className="mt-[clamp(28px,4vw,44px)] grid items-start"
        style={{
          gap: "clamp(16px, 2.5vw, 22px)",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        }}
      >
        <div className="rounded-[18px] border border-[rgba(12,20,30,0.1)] bg-paper p-5">
          <IllustrativeBadge label={sms.badge} />
          <h3 className="mt-3 font-heading text-[18px] font-bold tracking-[-0.03em] text-navy">
            {sms.title}
          </h3>
          <div className="mt-5 flex flex-col gap-2.5">
            {sms.lines.map((line, i) => {
              if (line.who === "event") {
                return (
                  <p
                    key={`${line.text}-${i}`}
                    className="rounded-full bg-[rgba(12,20,30,0.05)] px-3 py-2 text-center font-mono text-[11px] tracking-[0.04em] text-secondary"
                  >
                    {line.text}
                  </p>
                );
              }
              const outbound = line.who === "system";
              return (
                <p
                  key={`${line.text}-${i}`}
                  className={`max-w-[92%] rounded-[16px] px-3.5 py-2.5 text-[13.5px] leading-snug ${
                    outbound
                      ? "self-start rounded-bl-[5px] border border-[rgba(12,20,30,0.08)] bg-white text-navy"
                      : "self-end rounded-br-[5px] bg-navy text-white"
                  }`}
                >
                  {line.text}
                </p>
              );
            })}
          </div>
        </div>

        <TechnicianAlertCard {...alert} />

        <QuoteFollowUpTimeline
          badge={quoteBadge}
          headline={quoteHeadline}
          steps={quoteSteps}
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          href="#missed-call-demo"
          className="inline-flex items-center justify-center gap-2.5 rounded-[11px] bg-orange px-[22px] py-[14px] text-[15px] font-semibold tracking-[-0.01em] text-navy shadow-cta transition-[transform,background] duration-200 hover:translate-y-[-2px] hover:bg-orange-dark"
        >
          {demoCta}
        </a>
        <CTAButton href="/one-pager" variant="secondary">
          {onePagerCta}
        </CTAButton>
      </div>
    </div>
  );
}
