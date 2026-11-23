import { LogoMark } from "@/components/BrandLockup";

export type HomeHeroPreviewCopy = {
  /** Kept for i18n parity; not rendered (no watermark on the preview). */
  badge?: string;
  workspaceLabel: string;
  navOverview: string;
  navCalls: string;
  navRequests: string;
  statsAnswered: string;
  statsAnsweredValue: string;
  statsRequests: string;
  statsRequestsValue: string;
  callsTitle: string;
  requestsTitle: string;
  rows: {
    name: string;
    meta: string;
    status: string;
    statusTone: "answered" | "missed" | "new";
  }[];
  selectedTitle: string;
  selectedFields: { label: string; value: string }[];
};

const STATUS_CLASS = {
  answered: "bg-[rgba(47,158,104,0.12)] text-signal-text",
  missed: "bg-[rgba(228,118,43,0.12)] text-ember-text",
  new: "bg-[rgb(var(--ink-rgb)/0.06)] text-muted",
} as const;

/**
 * Controlled public preview of the TradeCatch workspace. All names and figures
 * are illustrative — never live customer data.
 */
export function HomeHeroPreview({ copy }: { copy: HomeHeroPreviewCopy }) {
  return (
    <div
      className="mx-auto w-full max-w-[960px]"
      aria-label={copy.workspaceLabel}
    >
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--ink-rgb)/0.1)] bg-white shadow-card">
        <div className="border-b border-[rgb(var(--ink-rgb)/0.08)] bg-paper px-4 py-2.5 sm:px-5">
          <p className="text-ui truncate text-[13px] text-muted">
            {copy.workspaceLabel}
          </p>
        </div>

        <div className="grid min-h-[280px] grid-cols-1 md:grid-cols-[11rem_minmax(0,1fr)] lg:min-h-[340px] lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-[rgb(var(--ink-rgb)/0.08)] bg-neutral-50 p-4 md:flex md:flex-col md:gap-6">
            <div className="flex items-center gap-2">
              <LogoMark className="h-8 w-8 rounded-[9px]" />
              <span className="text-ui font-semibold tracking-[-0.02em] text-heading">
                TradeCatch
              </span>
            </div>
            <nav aria-hidden className="flex flex-col gap-1 text-[13.5px]">
              {[copy.navOverview, copy.navCalls, copy.navRequests].map(
                (label, index) => (
                  <span
                    key={label}
                    className={
                      index === 1
                        ? "rounded-md bg-[rgb(var(--ink-rgb)/0.08)] px-2.5 py-2 font-medium text-heading"
                        : "rounded-md px-2.5 py-2 text-muted"
                    }
                  >
                    {label}
                  </span>
                ),
              )}
            </nav>
            <div className="mt-auto grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[rgb(var(--ink-rgb)/0.08)] bg-white px-2.5 py-2">
                <p className="text-[11px] text-muted">{copy.statsAnswered}</p>
                <p className="mt-0.5 font-heading text-[18px] font-bold tracking-[-0.03em] text-heading tabular-nums">
                  {copy.statsAnsweredValue}
                </p>
              </div>
              <div className="rounded-lg border border-[rgb(var(--ink-rgb)/0.08)] bg-white px-2.5 py-2">
                <p className="text-[11px] text-muted">{copy.statsRequests}</p>
                <p className="mt-0.5 font-heading text-[18px] font-bold tracking-[-0.03em] text-heading tabular-nums">
                  {copy.statsRequestsValue}
                </p>
              </div>
            </div>
          </aside>

          <div className="grid grid-cols-1 gap-0 sm:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="border-b border-[rgb(var(--ink-rgb)/0.08)] p-4 sm:border-r sm:border-b-0 sm:p-5">
              <p className="text-ui text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
                {copy.callsTitle}
              </p>
              <ul className="mt-3 m-0 flex list-none flex-col gap-2 p-0">
                {copy.rows.map((row, index) => (
                  <li
                    key={`${row.name}-${index}`}
                    className={
                      index === 0
                        ? "rounded-xl border border-navy/15 bg-[rgb(var(--ink-rgb)/0.03)] px-3 py-2.5"
                        : "rounded-xl border border-transparent px-3 py-2.5"
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-semibold tracking-[-0.015em] text-heading">
                          {row.name}
                        </p>
                        <p className="mt-0.5 truncate text-[13px] text-muted">
                          {row.meta}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[row.statusTone]}`}
                      >
                        {row.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-ui text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
                {copy.requestsTitle}
              </p>
              <h3 className="text-card-title mt-2 text-heading">
                {copy.selectedTitle}
              </h3>
              <dl className="mt-4 m-0 flex flex-col gap-3">
                {copy.selectedFields.map((field) => (
                  <div
                    key={field.label}
                    className="flex items-baseline justify-between gap-4 border-b border-[rgb(var(--ink-rgb)/0.08)] pb-2.5 last:border-b-0"
                  >
                    <dt className="text-[12.5px] text-muted">{field.label}</dt>
                    <dd className="m-0 text-right text-[14px] font-medium tracking-[-0.015em] text-heading">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
