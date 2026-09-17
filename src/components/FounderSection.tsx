import { CTAButton } from "@/components/CTAButton";

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
    <div
      className="grid items-center gap-12"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
    >
      <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-[20px] bg-navy p-[clamp(24px,3vw,32px)] text-white shadow-ink-panel">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage:
              "radial-gradient(85% 70% at 80% 0%, #000 20%, transparent 78%)",
          }}
        />
        <div className="relative">
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-[rgba(255,255,255,0.6)] uppercase">
            {workLabel}
          </p>
          <ol className="mt-5 flex list-none flex-col p-0">
            {work.map((item, i) => (
              <li
                key={item.title}
                className="flex gap-3.5 border-t border-white/10 py-3.5 first:border-t-0 first:pt-0"
              >
                <span className="pt-0.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-orange">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold tracking-[-0.015em] text-white">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-[13.5px] leading-[1.5] text-white/60">
                    {item.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-white/10 pt-4">
            <p className="font-heading text-[16px] font-bold tracking-[-0.02em] text-white">
              {name}
            </p>
            <p className="mt-0.5 text-[13.5px] text-white/60">{role}</p>
            <p className="mt-2 font-mono text-[10.5px] tracking-[0.1em] text-[rgba(255,255,255,0.5)] uppercase">
              {floatLabel}
            </p>
          </div>
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
