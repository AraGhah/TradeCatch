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
    <div
      className="grid items-stretch gap-5"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
    >
      <div className="flex h-full flex-col rounded-[20px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface/70 p-7">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#C4564A]" />
          <p className="font-heading text-[17px] font-bold tracking-[-0.02em] text-heading">
            {manualLabel}
          </p>
        </div>
        <ul className="flex flex-1 flex-col">
          {rows.map((row) => (
            <li
              key={row.manual}
              className="flex flex-1 items-start border-b border-[rgb(var(--ink-rgb)/0.08)] py-[14px] text-[14.5px] leading-[1.55] text-muted last:border-0"
            >
              {row.manual}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex h-full flex-col rounded-[20px] bg-navy p-7 text-white shadow-ink-panel">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green" />
          <p className="font-heading text-[17px] font-bold tracking-[-0.02em] text-orange">
            {systemLabel}
          </p>
        </div>
        <ul className="flex flex-1 flex-col">
          {rows.map((row) => (
            <li
              key={row.system}
              className="flex flex-1 items-start border-b border-white/[0.08] py-[14px] text-[14.5px] leading-[1.55] text-white/85 last:border-0"
            >
              {row.system}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
