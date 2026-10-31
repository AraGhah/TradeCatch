"use client";

import { useState } from "react";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  PREMIUM_PLAN,
  type CapabilityId,
  type PlanId,
} from "@/product/saas/plan-catalog";

export type PlanWalkthroughCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  illustrativeLabel: string;
  selectLabel: string;
  next: string;
  previous: string;
  stepOf: string;
  planKinds: Record<PlanId, string>;
  planNames: Record<PlanId, string>;
  /** Short scene lines keyed by capability id. */
  scenes: Record<string, { title: string; body: string }>;
};

/**
 * Illustrative, interactive walkthrough per plan. Only shows capabilities the
 * plan really has (from PLAN_CATALOG.demo). When live-action film lands in
 * /public/demo-video/plans, the catalog `demo.media` fields switch the player
 * on; until then this is the demonstration.
 */
export function PlanWalkthrough({
  copy,
  initialPlan = "starter",
}: {
  copy: PlanWalkthroughCopy;
  initialPlan?: PlanId;
}) {
  const [plan, setPlan] = useState<PlanId>(
    PLAN_ORDER.includes(initialPlan) ? initialPlan : "starter",
  );
  const [step, setStep] = useState(0);
  const demoIds = PLAN_CATALOG[plan].demo.capabilities;
  const scenes = demoIds
    .map((id) => ({ id, ...copy.scenes[id] }))
    .filter((s): s is { id: CapabilityId; title: string; body: string } =>
      Boolean(s.title && s.body),
    );
  const index = Math.min(step, Math.max(scenes.length - 1, 0));
  const current = scenes[index];
  const premium = plan === PREMIUM_PLAN;

  function selectPlan(next: PlanId) {
    setPlan(next);
    setStep(0);
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-ember-text">{copy.eyebrow}</p>
      <h2 className="mt-3 max-w-[18em] font-heading text-[clamp(26px,3vw,38px)] font-extrabold leading-[1.06] tracking-[-0.038em] text-heading">
        {copy.title}
      </h2>
      <p className="mt-4 max-w-[46em] text-[16px] leading-[1.6] text-muted">
        {copy.intro}
      </p>

      <div
        role="tablist"
        aria-label={copy.selectLabel}
        className="mt-8 flex flex-wrap gap-2"
      >
        {PLAN_ORDER.map((id) => {
          const selected = id === plan;
          const isPremium = id === PREMIUM_PLAN;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectPlan(id)}
              className={`rounded-md px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 ${
                selected
                  ? isPremium
                    ? "bg-navy text-white ring-2 ring-orange"
                    : "bg-navy text-white"
                  : "border border-[rgb(var(--ink-rgb)/0.12)] bg-surface text-heading hover:border-[rgb(var(--ink-rgb)/0.28)]"
              }`}
            >
              <span
                className={`block font-mono text-[10px] tracking-[0.08em] uppercase ${
                  selected ? "text-orange" : "text-muted"
                }`}
              >
                {copy.planKinds[id]}
              </span>
              <span className="mt-0.5 block font-heading text-[15px] font-bold tracking-[-0.02em]">
                {copy.planNames[id]}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`mt-6 overflow-hidden border ${
          premium
            ? "border-orange/40 bg-navy text-white"
            : "border-[rgb(var(--ink-rgb)/0.1)] bg-surface"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <p
            className={`font-mono text-[11px] tracking-[0.1em] uppercase ${
              premium ? "text-orange" : "text-ember-text"
            }`}
          >
            {copy.illustrativeLabel}
          </p>
          {scenes.length > 0 ? (
            <p
              className={`font-mono text-[11px] ${
                premium ? "text-white/55" : "text-muted"
              }`}
            >
              {copy.stepOf
                .replace("{current}", String(index + 1))
                .replace("{total}", String(scenes.length))}
            </p>
          ) : null}
        </div>

        {current ? (
          <div className="px-5 py-8 sm:px-8">
            <p
              className={`font-mono text-[11px] tracking-[0.08em] uppercase ${
                premium ? "text-orange" : "text-ember-text"
              }`}
            >
              {copy.planNames[plan]}
            </p>
            <h3
              className={`mt-3 font-heading text-[clamp(22px,2.6vw,30px)] font-extrabold tracking-[-0.035em] ${
                premium ? "text-white" : "text-heading"
              }`}
            >
              {current.title}
            </h3>
            <p
              className={`mt-4 max-w-[40em] text-[16px] leading-[1.65] ${
                premium ? "text-white/72" : "text-secondary"
              }`}
            >
              {current.body}
            </p>
          </div>
        ) : (
          <p className="px-5 py-8 text-muted">—</p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
              premium
                ? "bg-white/10 text-white hover:bg-white/16"
                : "border border-[rgb(var(--ink-rgb)/0.14)] text-heading hover:bg-[rgb(var(--ink-rgb)/0.04)]"
            }`}
          >
            {copy.previous}
          </button>
          <button
            type="button"
            disabled={index >= scenes.length - 1}
            onClick={() => setStep((s) => Math.min(scenes.length - 1, s + 1))}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
              premium
                ? "bg-orange text-white hover:opacity-90"
                : "bg-navy text-white hover:opacity-90"
            }`}
          >
            {copy.next}
          </button>
        </div>
      </div>
    </div>
  );
}
