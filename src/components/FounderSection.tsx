import { CTAButton } from "@/components/CTAButton";
import { EmailContactLink } from "@/components/EmailContactLink";

export type FounderWorkStep = { title: string; body: string };

/**
 * The founder's process card: four numbered steps and his signature on dark
 * navy. Styled with utilities only. `.tc-card` must not be used here: it is
 * unlayered CSS, so its light `background` beats the `bg-navy` utility and the
 * white text disappears (the card then reads as an empty box).
 */
export function FounderProcessCard({
  label,
  steps,
  name,
  role,
}: {
  label: string;
  steps: FounderWorkStep[];
  name: string;
  role: string;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-[var(--radius-xl)] bg-navy p-6 text-white shadow-ink-panel sm:p-8">
      {/* Orange accent along the top edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-orange), rgb(228 118 43 / 0.5) 45%, transparent)",
        }}
      />
      <p
        id="founder-process-label"
        className="font-mono text-[11px] font-medium tracking-[0.12em] text-white/70 uppercase"
      >
        {label}
      </p>
      <ol
        aria-labelledby="founder-process-label"
        className="m-0 mt-5 flex list-none flex-col p-0"
      >
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-white/10 py-4 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[2.25rem_1fr] sm:gap-x-4"
          >
            <span
              aria-hidden
              className="pt-[3px] font-mono text-[12px] font-semibold tracking-[0.08em] text-orange tabular-nums"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className="font-heading text-[16px] font-bold tracking-[-0.02em] text-white">
                {step.title}
              </p>
              <p className="mt-1 text-[14.5px] leading-[1.55] text-white/70">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-5">
        <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full bg-orange" />
        <p className="m-0 min-w-0 text-[14px] leading-[1.4] text-white/70">
          <span className="font-heading text-[16px] font-bold tracking-[-0.02em] text-white">
            {name}
          </span>
          <span aria-hidden className="mx-1.5 text-orange">
            —
          </span>
          <span className="whitespace-nowrap">{role}</span>
        </p>
      </div>
    </div>
  );
}

export function FounderSection({
  eyebrow,
  headline,
  name,
  role,
  statement,
  points,
  workLabel,
  work,
  emailLabel,
  email,
  talkCta,
}: {
  eyebrow: string;
  headline: string;
  name: string;
  role: string;
  statement: string;
  points: string[];
  workLabel: string;
  work: FounderWorkStep[];
  emailLabel: string;
  email: string;
  talkCta: string;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <FounderProcessCard label={workLabel} steps={work} name={name} role={role} />

      <div>
        <p className="text-ui mb-2 text-[13px] font-medium text-ember-text">
          {eyebrow}
        </p>
        <h2 className="text-section text-heading">{headline}</h2>
        <blockquote className="mt-5 border-l-2 border-[rgb(var(--ink-rgb)/0.2)] pl-5 text-[16.5px] leading-[1.6] text-heading">
          {statement}
        </blockquote>
        <ul className="mt-5 m-0 list-none space-y-2.5 p-0">
          {points.map((point) => (
            <li
              key={point}
              className="text-[15px] leading-relaxed text-secondary before:mr-2 before:text-muted before:content-['–']"
            >
              {point}
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-wrap items-center gap-5">
          <CTAButton href="/book-audit" variant="ink" size="md">
            {talkCta}
          </CTAButton>
          <EmailContactLink
            email={email}
            className="text-[15px] font-semibold text-ember-text underline decoration-ember-text/40 underline-offset-4 transition-colors hover:text-heading"
          >
            {emailLabel}
          </EmailContactLink>
        </div>
      </div>
    </div>
  );
}
