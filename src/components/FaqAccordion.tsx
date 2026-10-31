/**
 * Native <details> accordion: no client JavaScript, answers stay in the
 * server-rendered HTML for crawlers, and closed answers are hidden from
 * assistive technology until opened.
 */
export function FaqAccordion({
  items,
  bordered = false,
}: {
  items: { q: string; a: string }[];
  bordered?: boolean;
}) {
  return (
    <div
      className={
        bordered
          ? "rounded-[18px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-6"
          : ""
      }
    >
      {items.map((item) => (
        <details
          key={item.q}
          className="group border-b border-[rgb(var(--ink-rgb)/0.12)] last:border-b-0"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-[22px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange [&::-webkit-details-marker]:hidden">
            <span className="font-heading text-[17px] font-semibold tracking-[-0.02em] text-heading transition-colors duration-200 group-hover:text-ember-text sm:text-[18.5px]">
              {item.q}
            </span>
            <span
              aria-hidden
              className="shrink-0 font-mono text-[18px] font-medium text-ember-text transition-transform duration-200 group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="pb-6 text-[15px] leading-[1.65] text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
