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
        <span className="font-mono text-[12px] tracking-[0.08em] text-[rgba(255,255,255,0.64)]">
          {period}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.08em] text-green uppercase">
          <span className="h-1.5 w-1.5 animate-tc-pulse rounded-full bg-green" />
          {liveLabel}
        </span>
      </div>

      <div
        className="grid gap-px overflow-hidden rounded-[14px] bg-white/10"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
        }}
      >
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-ink-panel p-4">
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

      <p className="mt-5 font-mono text-[11px] tracking-[0.06em] text-[rgba(255,255,255,0.42)]">
        {sampleDataLabel}
      </p>
    </div>
  );
}
