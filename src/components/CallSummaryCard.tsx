import { IllustrativeBadge } from "@/components/IllustrativeBadge";

/**
 * Sample post-call summary. Values are demo data, never client results — the
 * badge stays attached to the card for that reason.
 */
export function CallSummaryCard({
  cardLabel,
  sampleBadge,
  fields,
}: {
  cardLabel: string;
  sampleBadge: string;
  fields: { label: string; value: string }[];
}) {
  return (
    <div className="overflow-hidden border border-[rgb(var(--ink-rgb)/0.12)] bg-surface shadow-[0_28px_56px_-40px_rgb(var(--ink-rgb)/0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-navy px-5 py-4">
        <p className="flex items-center gap-2.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-orange uppercase">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-orange" />
          {cardLabel}
        </p>
        <IllustrativeBadge label={sampleBadge} light />
      </div>

      <dl className="m-0 flex flex-col px-5 py-2">
        {fields.map((field) => (
          <div
            key={field.label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[rgb(var(--ink-rgb)/0.08)] py-3 last:border-b-0"
          >
            <dt className="font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">
              {field.label}
            </dt>
            <dd className="m-0 max-w-[24em] text-right text-[15px] leading-[1.45] font-semibold tracking-[-0.015em] text-heading">
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
