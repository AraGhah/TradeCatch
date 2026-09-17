export type FlowNode = { title: string; body: string };

/**
 * Linear call path, then the three branches a call can take, then the shared
 * outcome. Rendered as an ordered list so the sequence survives without CSS.
 */
export function CallFlowDiagram({
  steps,
  branchLabel,
  branches,
  outcomeLabel,
  outcome,
  note,
}: {
  steps: FlowNode[];
  branchLabel: string;
  branches: FlowNode[];
  outcomeLabel: string;
  outcome: FlowNode[];
  note: string;
}) {
  return (
    <div>
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="relative flex flex-col border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-5"
          >
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ember-text">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-3 font-heading text-[17.5px] font-bold tracking-[-0.026em] text-heading">
              {step.title}
            </h3>
            <p className="mt-2 text-[14.5px] leading-[1.55] text-muted">
              {step.body}
            </p>
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-1/2 -right-[13px] hidden -translate-y-1/2 font-mono text-[15px] text-orange/70 lg:block"
              >
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-8 flex items-center gap-4">
        <span aria-hidden className="h-px flex-1 bg-[rgb(var(--ink-rgb)/0.14)]" />
        <p className="font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
          {branchLabel}
        </p>
        <span aria-hidden className="h-px flex-1 bg-[rgb(var(--ink-rgb)/0.14)]" />
      </div>

      <ul className="m-0 mt-5 grid list-none gap-3 p-0 md:grid-cols-3">
        {branches.map((branch) => (
          <li
            key={branch.title}
            className="border-t-[3px] border-orange border-x border-b border-x-[rgb(var(--ink-rgb)/0.1)] border-b-[rgb(var(--ink-rgb)/0.1)] bg-surface p-5"
          >
            <h3 className="font-heading text-[17px] font-bold tracking-[-0.026em] text-heading">
              {branch.title}
            </h3>
            <p className="mt-2 text-[14.5px] leading-[1.55] text-muted">
              {branch.body}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-8 bg-navy p-[clamp(22px,3vw,32px)] text-white">
        <p className="font-mono text-[10.5px] tracking-[0.12em] text-[rgba(255,255,255,0.6)] uppercase">
          {outcomeLabel}
        </p>
        <div className="mt-5 grid gap-x-10 gap-y-5 md:grid-cols-2">
          {outcome.map((item) => (
            <div key={item.title}>
              <h3 className="font-heading text-[17.5px] font-bold tracking-[-0.026em] text-orange">
                {item.title}
              </h3>
              <p className="mt-2 text-[15px] leading-[1.6] text-white/70">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-5 max-w-[52em] text-[13.5px] leading-[1.6] text-muted">
        {note}
      </p>
    </div>
  );
}
