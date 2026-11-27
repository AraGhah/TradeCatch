"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Two ways to see the product in one section: the story video (rendered on
 * the server and shown first, so the page reads the same without script) and
 * a hands-on simulation. Follows the ARIA tabs pattern: arrow keys, Home and
 * End move between tabs. Without script the tab row is hidden and the first
 * panel is all there is. Later panels are built only once first opened, so
 * the page HTML carries just the first one.
 */
export function DemoTabs({
  label,
  tabs,
  panels,
}: {
  label: string;
  tabs: [string, string];
  panels: [ReactNode, ReactNode];
}) {
  const [active, setActive] = useState(0);
  // Panels fade in only after the visitor switches, never on page load.
  const [touched, setTouched] = useState(false);
  const select = (i: number) => {
    setTouched(true);
    setActive(i);
  };
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: (active + 1) % tabs.length,
      ArrowLeft: (active - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="tc-tabs" data-touched={touched ? "" : undefined}>
      <div
        role="tablist"
        aria-label={label}
        className="tc-tabs-list relative mb-[clamp(18px,2.4vw,28px)] inline-flex rounded-full border border-[rgb(var(--ink-rgb)/0.14)] bg-surface p-1"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab}
            ref={(node) => {
              refs.current[i] = node;
            }}
            id={`${base}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={active === i}
            aria-controls={`${base}-panel-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={onKeyDown}
            className="tc-tab min-h-10 rounded-full px-4 text-[14px] font-semibold text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {tab}
          </button>
        ))}
      </div>
      {panels.map((panel, i) => (
        <div
          key={i}
          id={`${base}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${i}`}
          hidden={active !== i}
          className="tc-tab-panel"
        >
          {i === 0 || touched ? panel : null}
        </div>
      ))}
    </div>
  );
}
