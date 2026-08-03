import Image from "next/image";
import { CTAButton } from "@/components/CTAButton";

export function FounderSection({
  eyebrow,
  headline,
  name,
  floatLabel,
  statement,
  points,
  emailLabel,
  email,
  talkCta,
}: {
  eyebrow: string;
  headline: string;
  name: string;
  floatLabel: string;
  statement: string;
  points: string[];
  emailLabel: string;
  email: string;
  talkCta: string;
}) {
  return (
    <div
      className="grid items-center gap-12"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
    >
      <div className="relative mx-auto w-full max-w-[360px]">
        <div className="aspect-[4/5] overflow-hidden rounded-[20px] bg-paper-deep">
          <Image
            src="/images/founder.jpg"
            alt={name}
            width={720}
            height={900}
            className="h-full w-full object-cover"
            priority={false}
          />
        </div>
        <div className="absolute right-[-14px] bottom-[-18px] rounded-[14px] bg-navy px-5 py-3.5 text-white shadow-ink-panel">
          <p className="font-mono text-[10.5px] tracking-[0.1em] text-[rgba(255,255,255,0.64)] uppercase">
            {floatLabel}
          </p>
          <p className="mt-1 font-heading text-[16px] font-bold tracking-[-0.02em]">
            {name}
          </p>
        </div>
      </div>

      <div>
        <p className="text-mono-label text-muted">{eyebrow}</p>
        <h2 className="text-section mt-4 text-heading">{headline}</h2>
        <blockquote className="mt-6 border-l-2 border-orange pl-5 text-[17px] leading-[1.65] text-heading">
          {statement}
        </blockquote>
        <ul className="mt-7 space-y-3">
          {points.map((point) => (
            <li
              key={point}
              className="flex items-start gap-3 text-[15px] leading-relaxed text-secondary"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
              {point}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <CTAButton href="/book-audit" variant="ink" size="md">
            {talkCta}
          </CTAButton>
          <a
            href={`mailto:${email}`}
            className="text-[15px] font-semibold text-ember-text underline decoration-ember-text/40 underline-offset-4 transition-colors hover:text-heading"
          >
            {emailLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
