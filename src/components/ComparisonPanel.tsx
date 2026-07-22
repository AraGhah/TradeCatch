import { CheckIcon, AlertIcon } from "@/components/icons";

export function ComparisonPanel({
  manualLabel,
  systemLabel,
  rows,
}: {
  manualLabel: string;
  systemLabel: string;
  rows: { manual: string; system: string }[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-card">
      <div className="grid grid-cols-2 divide-x divide-navy/10 border-b border-navy/10 bg-bg">
        <p className="px-5 py-4 text-sm font-semibold text-text/70 sm:px-6">
          {manualLabel}
        </p>
        <p className="px-5 py-4 text-sm font-semibold text-navy sm:px-6">
          {systemLabel}
        </p>
      </div>
      <div className="divide-y divide-navy/10">
        {rows.map((row) => (
          <div key={row.manual} className="grid grid-cols-2 divide-x divide-navy/10">
            <div className="flex items-start gap-3 px-5 py-5 sm:px-6">
              <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-orange-dark" />
              <p className="text-base leading-relaxed text-text/80">{row.manual}</p>
            </div>
            <div className="flex items-start gap-3 px-5 py-5 sm:px-6">
              <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-green" />
              <p className="text-base leading-relaxed text-navy">{row.system}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
