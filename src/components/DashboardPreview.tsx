import { ChartIcon } from "@/components/icons";
import { StaggerGroup, StaggerItem } from "@/components/motion/StaggerGroup";

export function DashboardPreview({
  metrics,
  badge,
  liveLabel,
  sampleDataLabel,
}: {
  metrics: { value: string; label: string }[];
  badge: string;
  liveLabel: string;
  sampleDataLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-7">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-navy">
          <ChartIcon className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            {badge}
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-medium text-blue">
          <span className="h-1.5 w-1.5 rounded-full bg-blue" />
          {liveLabel}
        </span>
      </div>
      <StaggerGroup className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <StaggerItem key={metric.label}>
            <div className="h-full rounded-lg border border-navy/10 bg-bg p-4 transition-colors duration-200 hover:border-blue/30 hover:bg-blue/5">
              <p className="text-2xl font-bold text-navy">{metric.value}</p>
              <p className="mt-1 text-xs leading-snug text-text/70">{metric.label}</p>
            </div>
          </StaggerItem>
        ))}
      </StaggerGroup>
      <p className="mt-5 border-t border-navy/10 pt-4 text-xs text-text/50">
        {sampleDataLabel}
      </p>
    </div>
  );
}
