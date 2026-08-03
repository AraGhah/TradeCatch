import { IllustrativeBadge } from "@/components/IllustrativeBadge";

type Step = { day: string; title: string; body: string };

export function QuoteFollowUpTimeline({
  badge,
  headline,
  steps,
}: {
  badge: string;
  headline: string;
  steps: Step[];
}) {
  return (
    <div className="rounded-[18px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-5 sm:p-6">
      <IllustrativeBadge label={badge} />
      <h3 className="mt-3 font-heading text-[18px] font-bold tracking-[-0.03em] text-heading">
        {headline}
      </h3>

      <ol className="mt-6 space-y-0">
        {steps.map((step, i) => (
          <li key={`${step.day}-${step.title}`} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-7 left-[11px] h-[calc(100%-1.25rem)] w-px bg-[rgb(var(--ink-rgb)/0.12)]"
              />
            ) : null}
            <span className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-orange/40 bg-[rgba(228,118,43,0.12)] font-mono text-[10px] font-semibold text-ember-text">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                {step.day}
              </p>
              <p className="mt-1 text-[15px] font-semibold text-heading">{step.title}</p>
              <p className="mt-1 text-[14px] leading-[1.55] text-secondary">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
