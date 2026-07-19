import { ChartIcon } from "@/components/icons";

export function DashboardPreview({ metrics }: { metrics: string[] }) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-navy">
        <ChartIcon className="h-5 w-5" />
        <span className="text-sm font-semibold uppercase tracking-wide">
          Recovery dashboard
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric}
            className="rounded-lg border border-navy/10 bg-bg p-4"
          >
            <p className="text-2xl font-bold text-navy">—</p>
            <p className="mt-1 text-xs leading-snug text-text/70">{metric}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
