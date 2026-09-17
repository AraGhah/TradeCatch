export type PlanComparisonValue = "y" | "n" | "p";

export type PlanComparisonData = {
  eyebrow: string;
  title: string;
  intro: string;
  featureLabel: string;
  columns: string[];
  includedLabel: string;
  notIncludedLabel: string;
  plannedLabel: string;
  rows: { feature: string; values: PlanComparisonValue[] }[];
  note: string;
};

/**
 * Upgrade-path table. Laid out as a real table so it stays readable with a
 * screen reader; the value columns are narrow enough to avoid horizontal
 * scrolling on a 320px viewport.
 */
export function PlanComparison({ data }: { data: PlanComparisonData }) {
  const labels = {
    y: data.includedLabel,
    n: data.notIncludedLabel,
    p: data.plannedLabel,
  };

  return (
    <div>
      <p className="text-[13px] font-medium text-ember-text">{data.eyebrow}</p>
      <h2 className="mt-3 max-w-[16em] font-heading text-[clamp(26px,3vw,38px)] font-extrabold leading-[1.06] tracking-[-0.038em] text-heading">
        {data.title}
      </h2>
      <p className="mt-4 max-w-[46em] text-[16px] leading-[1.6] text-muted">
        {data.intro}
      </p>

      <table className="mt-9 w-full table-fixed border-collapse text-left">
        <caption className="sr-only">{data.title}</caption>
        <thead>
          <tr className="border-b border-[rgb(var(--ink-rgb)/0.16)]">
            <th
              scope="col"
              className="w-auto py-3 pr-3 align-bottom font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted uppercase"
            >
              {data.featureLabel}
            </th>
            {data.columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={`w-[52px] py-3 pl-1 text-center align-bottom font-heading text-[11.5px] leading-[1.25] font-bold tracking-[-0.01em] break-words sm:w-[110px] sm:text-[14px] ${
                  i === data.columns.length - 1 ? "text-ember-text" : "text-heading"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr
              key={row.feature}
              className="border-b border-[rgb(var(--ink-rgb)/0.08)]"
            >
              <th
                scope="row"
                className="py-3.5 pr-3 text-[13.5px] leading-[1.45] font-medium text-secondary sm:text-[15px]"
              >
                {row.feature}
              </th>
              {row.values.map((value, i) => (
                <td
                  key={`${row.feature}-${data.columns[i]}`}
                  className="py-3.5 pl-1 text-center align-middle"
                >
                  <Mark value={value} label={labels[value]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 max-w-[54em] text-[13.5px] leading-[1.6] text-muted">
        {data.note}
      </p>
    </div>
  );
}

function Mark({ value, label }: { value: PlanComparisonValue; label: string }) {
  if (value === "y") {
    return (
      <span className="inline-flex items-center justify-center text-[15px] font-bold text-signal-text">
        <span aria-hidden>✓</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (value === "p") {
    return (
      <span className="inline-flex items-center justify-center font-mono text-[9px] leading-tight tracking-[0.04em] text-muted uppercase sm:text-[10px]">
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-center text-[15px] text-[rgb(var(--ink-rgb)/0.28)]">
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
