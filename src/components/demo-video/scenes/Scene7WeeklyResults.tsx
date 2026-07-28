"use client";

import { DEMO_DATA } from "../timeline";
import type { SceneProps } from "../DemoVideoExperience";

/**
 * Eased count-up driven by scene progress. The windows are deliberately short:
 * every figure must be locked at its final value for the vast majority of the
 * scene so no frame — or locale — can disagree about the numbers.
 */
function countUp(target: number, p: number, from = 0.03, to = 0.2) {
  const t = Math.min(1, Math.max(0, (p - from) / (to - from)));
  return Math.round(target * (1 - Math.pow(1 - t, 3)));
}

export function Scene7WeeklyResults({ p, copy }: SceneProps) {
  const w = DEMO_DATA.weekly;
  const metrics = [
    { value: countUp(w.missedCalls, p), label: copy.missedAnswered, prefix: "" },
    { value: countUp(w.qualified, p, 0.05), label: copy.qualified, prefix: "" },
    { value: countUp(w.appointments, p, 0.07), label: copy.appointmentsBooked, prefix: "" },
    {
      value: countUp(w.potentialValue, p, 0.09, 0.22),
      label: copy.potentialValue,
      prefix: "CA$",
      format: true,
    },
  ];

  const showEstimates = p >= 0.26;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="relative z-10 w-full max-w-[1260px] px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[13px] tracking-[0.14em] text-white/45 uppercase">
              {copy.weeklyResults}
            </p>
            <h2 className="mt-1 font-heading text-[clamp(30px,3.4vw,42px)] font-extrabold tracking-[-0.035em] text-white">
              NorthStar Plumbing
            </h2>
          </div>
          <span className="rounded-md border border-orange/30 bg-orange/10 px-4 py-2 text-[16px] font-medium text-orange/90">
            {copy.demoData}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0 border border-white/10 bg-[#121c28] p-5 sm:p-6">
              <p className="font-heading text-[clamp(26px,2.1vw,36px)] font-extrabold tracking-[-0.03em] text-white tabular-nums">
                {m.prefix}
                {m.format ? m.value.toLocaleString("en-CA") : m.value}
              </p>
              <p className="mt-1.5 text-[15px] leading-snug text-white/55">{m.label}</p>
            </div>
          ))}
        </div>

        <div
          className={`mt-4 border border-white/10 bg-[#121c28] px-6 py-5 transition-all duration-300 ${
            showEstimates ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Shown at its final value: a mid-count frame would contradict the
              other locale's export. */}
          <p className="text-[21px] font-semibold text-white">
            <span className="text-orange">{w.estimatesReactivated}</span>{" "}
            {copy.estimatesReactivated}
          </p>
        </div>
      </div>
    </div>
  );
}
