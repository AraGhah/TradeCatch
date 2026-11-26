import { IllustrativeBadge } from "@/components/IllustrativeBadge";

/**
 * Sample post-call summary. Values are demo data, never client results —
 * a quiet note stays on the card for that reason (no sticker / watermark).
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
    <div className="tc-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-navy px-5 py-4">
        <p className="text-[13px] font-medium text-white">{cardLabel}</p>
        <IllustrativeBadge label={sampleBadge} light />
      </div>

      <dl className="m-0 flex flex-col px-5 py-2">
        {fields.map((field) => (
          <div
            key={field.label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[rgb(var(--ink-rgb)/0.08)] py-3 last:border-b-0"
          >
            <dt className="text-[12.5px] text-muted">{field.label}</dt>
            <dd className="m-0 max-w-[24em] text-right text-[15px] leading-[1.45] font-semibold tracking-[-0.015em] text-heading">
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
