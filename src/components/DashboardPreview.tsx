export function DashboardPreview({
  metrics,
  period,
  liveLabel,
  sampleDataLabel,
}: {
  metrics: { value: string; label: string }[];
  period: string;
  liveLabel: string;
  sampleDataLabel: string;
}) {
  return (
    <div className="rounded-[20px] bg-ink-panel p-5 shadow-ink-panel sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-[13px] text-[rgba(255,255,255,0.64)]">{period}</span>
        <span className="text-[12px] text-green">{liveLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="border border-white/10 bg-navy/40 p-4"
          >
            <p
              data-count
              className="font-heading text-[28px] font-extrabold tracking-[-0.03em] text-white"
            >
              {metric.value}
            </p>
            <p className="mt-1 text-[12.5px] leading-snug text-[rgba(255,255,255,0.64)]">
              {metric.label}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-5 text-[12px] text-[rgba(255,255,255,0.42)]">
        {sampleDataLabel}
      </p>
    </div>
  );
}
