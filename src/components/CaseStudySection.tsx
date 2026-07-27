import { CTAButton } from "@/components/CTAButton";

type Metric = { value: string; label: string };

export function CaseStudySection({
  eyebrow,
  headline,
  client,
  problemLabel,
  systemLabel,
  problem,
  system,
  quote,
  disclaimer,
  metrics,
  cta,
}: {
  eyebrow: string;
  headline: string;
  client: string;
  problemLabel: string;
  systemLabel: string;
  problem: string;
  system: string;
  quote: string;
  disclaimer: string;
  metrics: Metric[];
  cta: string;
}) {
  return (
    <div data-reveal>
      <p className="text-[13px] font-medium tracking-[-0.01em] text-ember-text">
        {eyebrow}
      </p>
      <h2 className="mt-3 max-w-[min(100%,34rem)] font-heading text-[clamp(28px,3.4vw,44px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-navy">
        {headline}
      </h2>
      <p className="mt-3 text-[14px] text-muted">{client}</p>

      <div
        className="mt-[clamp(28px,4vw,44px)] grid items-start"
        style={{
          gap: "clamp(28px, 4vw, 48px)",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
        }}
      >
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-[13px] font-semibold text-navy">{problemLabel}</p>
            <p className="mt-2 text-[16px] leading-[1.65] text-secondary">
              {problem}
            </p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-navy">{systemLabel}</p>
            <p className="mt-2 text-[16px] leading-[1.65] text-secondary">
              {system}
            </p>
          </div>
          <blockquote className="border-l-[3px] border-orange pl-5 text-[17px] leading-[1.55] font-medium text-navy">
            “{quote}”
          </blockquote>
          <CTAButton href="/book-audit" variant="ember">
            {cta}
          </CTAButton>
        </div>

        {/* Fixed 2×3 / 3×2 — never leaves empty grey tracks */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="flex min-h-[108px] flex-col justify-between border border-[rgba(12,20,30,0.1)] bg-white px-4 py-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[rgba(12,20,30,0.2)]"
            >
              <p className="font-heading text-[clamp(26px,2.4vw,32px)] font-extrabold tracking-[-0.04em] text-navy">
                {m.value}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-muted">{m.label}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-8 max-w-[52em] text-[13.5px] leading-[1.55] text-muted">
        {disclaimer}
      </p>
    </div>
  );
}
