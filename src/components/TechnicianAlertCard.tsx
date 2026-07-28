import { IllustrativeBadge } from "@/components/IllustrativeBadge";

export function TechnicianAlertCard({
  badge,
  title,
  fromLabel,
  jobLabel,
  addressLabel,
  urgencyLabel,
  from,
  job,
  address,
  urgency,
  ctaLabel,
}: {
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
}) {
  return (
    <div className="relative overflow-hidden rounded-[18px] border border-[rgba(12,20,30,0.1)] bg-white p-5 shadow-[0_20px_40px_-28px_rgba(12,20,30,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <IllustrativeBadge label={badge} />
          <h3 className="mt-3 font-heading text-[18px] font-bold tracking-[-0.03em] text-navy">
            {title}
          </h3>
        </div>
        <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-tc-pulse rounded-full bg-orange" />
      </div>

      <dl className="mt-5 space-y-3 border-t border-[rgba(12,20,30,0.08)] pt-4">
        <div>
          <dt className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
            {fromLabel}
          </dt>
          <dd className="mt-1 text-[14.5px] font-medium text-navy">{from}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
            {jobLabel}
          </dt>
          <dd className="mt-1 text-[14.5px] text-secondary">{job}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
            {addressLabel}
          </dt>
          <dd className="mt-1 text-[14.5px] text-secondary">{address}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
            {urgencyLabel}
          </dt>
          <dd className="mt-1 inline-flex rounded-md bg-[rgba(228,118,43,0.12)] px-2 py-1 text-[13px] font-semibold text-ember-text">
            {urgency}
          </dd>
        </div>
      </dl>

      <p className="mt-5 rounded-[10px] bg-navy px-4 py-3 text-center text-[13.5px] font-semibold text-white">
        {ctaLabel}
      </p>
    </div>
  );
}
