import { CTAButton } from "@/components/CTAButton";
import { EmailContactLink } from "@/components/EmailContactLink";

export function FounderSection({
  eyebrow,
  headline,
  name,
  role,
  floatLabel,
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
  floatLabel: string;
  statement: string;
  points: string[];
  workLabel: string;
  work: { title: string; body: string }[];
  emailLabel: string;
  email: string;
  talkCta: string;
}) {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="tc-card overflow-hidden bg-navy p-6 text-white md:p-8">
        <p className="text-ui text-[12px] font-medium tracking-[0.02em] text-white/55">
          {workLabel}
        </p>
        <ol className="mt-5 m-0 flex list-none flex-col gap-0 p-0">
          {work.map((item) => (
            <li
              key={item.title}
              className="border-t border-white/10 py-4 first:border-t-0 first:pt-0"
            >
              <p className="text-[15px] font-semibold tracking-[-0.015em] text-white">
                {item.title}
              </p>
              <p className="mt-1 text-[14px] leading-[1.5] text-white/60">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-2 border-t border-white/10 pt-4">
          <p className="font-heading text-[17px] font-bold tracking-[-0.02em] text-white">
            {name}
          </p>
          <p className="mt-0.5 text-[14px] text-white/60">{role}</p>
          <p className="mt-2 text-[12.5px] text-white/45">{floatLabel}</p>
        </div>
      </div>

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
