export function StatGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-navy/10 bg-white px-4 py-3">
          <p className="text-sm text-navy/60">{item.label}</p>
          <p className="mt-1 font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function MonthChart({
  rows,
  signupsLabel,
  cancellationsLabel,
}: {
  rows: { month: string; signups: number; cancellations: number }[];
  signupsLabel: string;
  cancellationsLabel: string;
}) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.signups, row.cancellations]));
  return (
    <figure>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {rows.map((row) => (
          <div key={row.month}>
            <div className="flex h-24 items-end gap-1">
              <div className="w-3 rounded-sm bg-navy" style={{ height: row.signups === 0 ? "0%" : `${(row.signups / max) * 100}%` }} />
              <div className="w-3 rounded-sm bg-orange" style={{ height: row.cancellations === 0 ? "0%" : `${(row.cancellations / max) * 100}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-navy/60">{row.month.slice(5)}</p>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-xs text-navy/60">
        <span>{signupsLabel}</span>
        <span>{cancellationsLabel}</span>
      </figcaption>
    </figure>
  );
}
