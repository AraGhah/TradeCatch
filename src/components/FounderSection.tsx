import { CheckIcon } from "@/components/icons";

export function FounderSection({
  headline,
  name,
  role,
  bio,
  points,
  emailLabel,
  email,
}: {
  headline: string;
  name: string;
  role: string;
  bio: string;
  points: string[];
  emailLabel: string;
  email: string;
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,240px)_1fr] lg:items-start">
      <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
        <span
          aria-hidden
          className="flex h-32 w-32 shrink-0 items-center justify-center rounded-2xl bg-navy text-3xl font-bold text-white shadow-card"
        >
          {initials}
        </span>
        <p className="mt-4 text-lg font-bold text-navy">{name}</p>
        <p className="text-sm text-text/70">{role}</p>
      </div>
      <div>
        <h2 className="text-2xl font-bold leading-tight text-navy sm:text-3xl">{headline}</h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-text/70">{bio}</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-sm text-text/70">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green" />
              {point}
            </li>
          ))}
        </ul>
        <a
          href={`mailto:${email}`}
          className="mt-6 inline-flex items-center gap-2 rounded-md text-sm font-semibold text-navy underline decoration-navy/30 underline-offset-4 transition-colors hover:text-blue"
        >
          {emailLabel}: {email}
        </a>
      </div>
    </div>
  );
}
