import type { ReactNode } from "react";

export type RecordPriority = "urgent" | "high" | "medium" | "low" | null;

export type CustomerRecordLabels = {
  service: string;
  problem: string;
  address: string;
  appointment: string;
  notes: string;
  /** Shown for a field the customer did not give. */
  notProvided: string;
  moreDetails: string;
  lessDetails: string;
};

const PRIORITY_STYLE: Record<Exclude<RecordPriority, null>, string> = {
  urgent: "border-red-300 bg-red-50 text-red-900",
  high: "border-orange-300 bg-orange-50 text-orange-900",
  medium: "border-navy/20 bg-navy/5 text-navy",
  low: "border-navy/15 bg-white text-navy/70",
};

/**
 * One customer request, readable in a few seconds: who, how to reach them,
 * what they need, where, how urgent, and whether a visit is booked. Long text
 * (notes, the original conversation) lives under "More details" so a list of
 * these stays compact. Purely presentational: it renders what it is given and
 * never makes anything up, so a missing value reads "Not provided".
 */
export function CustomerRecordCard({
  name,
  phone,
  service,
  problem,
  address,
  appointment,
  priority,
  priorityLabel,
  meta,
  labels,
  details,
}: {
  name: ReactNode;
  phone?: string;
  service?: string;
  problem?: string;
  address?: string;
  /** A ready-to-read line, e.g. "Wednesday, November 11, 3:00 PM", or "Not scheduled". */
  appointment: string;
  priority: RecordPriority;
  priorityLabel?: string;
  /** Small line under the phone number: status, source, time. */
  meta?: string;
  labels: CustomerRecordLabels;
  /** Notes and the original conversation. Rendered only when given. */
  details?: ReactNode;
}) {
  const rows: [string, string | undefined][] = [
    [labels.service, service],
    [labels.problem, problem],
    [labels.address, address],
    [labels.appointment, appointment],
  ];
  return (
    <article className="px-4 py-4" data-testid="customer-record">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 break-words text-base font-semibold text-navy">
            {name}
          </h3>
          {phone ? (
            <p className="m-0 mt-0.5 text-sm text-navy/80">{phone}</p>
          ) : null}
          {meta ? (
            <p className="m-0 mt-0.5 text-xs text-navy/50">{meta}</p>
          ) : null}
        </div>
        {priority && priorityLabel ? (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[priority]}`}
          >
            {priorityLabel}
          </span>
        ) : null}
      </header>

      <dl className="m-0 mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-navy/60">{label}</dt>
            <dd
              className={`m-0 break-words ${value ? "text-navy" : "text-navy/50"}`}
            >
              {value || labels.notProvided}
            </dd>
          </div>
        ))}
      </dl>

      {details ? (
        <details className="group mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-navy underline-offset-2 hover:underline">
            <span className="group-open:hidden">{labels.moreDetails}</span>
            <span className="hidden group-open:inline">
              {labels.lessDetails}
            </span>
          </summary>
          <div className="mt-2 flex flex-col gap-3 text-sm text-navy/80">
            {details}
          </div>
        </details>
      ) : null}
    </article>
  );
}
