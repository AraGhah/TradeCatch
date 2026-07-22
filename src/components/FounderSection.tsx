import Image from "next/image";
import { CTAButton } from "@/components/CTAButton";
import { CheckIcon } from "@/components/icons";

export function FounderSection({
  headline,
  name,
  role,
  statement,
  bio,
  points,
  emailLabel,
  email,
  talkCta,
}: {
  headline: string;
  name: string;
  role: string;
  statement: string;
  bio: string;
  points: string[];
  emailLabel: string;
  email: string;
  talkCta: string;
}) {
  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,280px)_1fr] lg:items-start">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Image
            src="/images/founder.jpg"
            alt={name}
            width={320}
            height={320}
            className="h-40 w-40 shrink-0 rounded-2xl object-cover shadow-card sm:h-44 sm:w-44"
          />
          <p className="mt-5 text-xl font-bold text-navy">{name}</p>
          <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-orange-dark">
            {role}
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold leading-tight text-navy sm:text-3xl">{headline}</h2>
          <blockquote className="mt-5 border-l-2 border-orange pl-4 text-lg leading-relaxed text-navy">
            {statement}
          </blockquote>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-text/70">{bio}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-base leading-relaxed text-text/80">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-green" />
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <CTAButton href="/book-audit" size="md">
              {talkCta}
            </CTAButton>
            <a
              href={`mailto:${email}`}
              className="inline-flex items-center gap-2 rounded-md text-sm font-semibold text-navy underline decoration-navy/30 underline-offset-4 transition-colors hover:text-blue"
            >
              {emailLabel}: {email}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
