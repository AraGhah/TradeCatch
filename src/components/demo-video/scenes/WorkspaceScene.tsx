"use client";

import { DEMO_DATA } from "../timeline";
import { Avatar, Panel, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/**
 * The owner's view: the receptionist call becomes a lead with a summary and an
 * appointment request, which a person confirms (Growth workspace booking).
 */
export function WorkspaceScene({ p, copy }: SceneProps) {
  const toast = p >= 0.04 && p < 0.42;
  const detailIn = p >= 0.1;
  const summaryIn = p >= 0.22;
  const requestIn = p >= 0.36;
  const cursorIn = p >= 0.55;
  const pressed = p >= 0.7;
  const confirmed = p >= 0.72;

  const rows = [
    {
      name: copy.callerName,
      initials: copy.callerInitials,
      detail: copy.valueService,
      meta: copy.leadSourceCall,
      selected: true,
    },
    {
      name: DEMO_DATA.caller2,
      initials: DEMO_DATA.caller2Initials,
      detail: copy.emergencyType,
      meta: copy.leadSourceTransfer,
      selected: false,
    },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_20%,rgba(228,118,43,0.1),transparent_50%)]" />

      <div className="relative z-10 w-full max-w-[1320px] -translate-y-[4vh] px-10">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="font-mono text-[14px] tracking-[0.14em] text-white/45 uppercase">
              {copy.workspace} · {copy.companyTitle}
            </p>
            <h2 className="mt-1 font-heading text-[clamp(30px,3vw,42px)] font-extrabold tracking-[-0.035em] text-white">
              {copy.workspaceHeadline}
            </h2>
          </div>
          <div
            className={`rounded-xl border border-orange/40 bg-orange/15 px-5 py-3 text-[17px] font-semibold text-orange shadow-[0_20px_40px_-20px_rgba(228,118,43,0.6)] ${reveal(toast, "right")}`}
          >
            {copy.newLeadToast}
          </div>
        </div>

        <div className="grid grid-cols-[0.75fr_1.25fr] gap-6">
          <Panel className="p-5">
            <p className="px-2 pb-3 text-[15px] font-semibold text-white/55">
              {copy.todaysCalls}
            </p>
            <div className="space-y-2.5">
              {rows.map((row) => (
                <div
                  key={row.name}
                  className={`flex items-center gap-3.5 rounded-xl border px-4 py-3.5 ${
                    row.selected
                      ? "border-orange/45 bg-orange/[0.08]"
                      : "border-white/[0.06] bg-white/[0.02]"
                  }`}
                >
                  <Avatar initials={row.initials} size={44} />
                  <div className="min-w-0">
                    <p className="text-[18px] font-semibold text-white">{row.name}</p>
                    <p className="truncate text-[15px] text-white/60">{row.detail}</p>
                    <p className="truncate text-[13px] text-white/40">{row.meta}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className={`relative p-7 ${reveal(detailIn)}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-heading text-[34px] font-extrabold tracking-[-0.03em] text-white">
                  {copy.callerName}
                </h3>
                <p className="text-[16px] text-white/55">{copy.leadSourceCall}</p>
              </div>
              <div className="text-right">
                <p className="text-[14px] text-white/45">{copy.callbackLabel}</p>
                <p className="font-mono text-[18px] text-white">{copy.callerPhone}</p>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-4">
              {[
                [copy.fieldService, copy.valueService],
                [copy.fieldArea, DEMO_DATA.location],
                [copy.fieldUrgency, copy.valueUrgency],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-white/10 pt-3">
                  <dt className="text-[14px] text-white/45">{label}</dt>
                  <dd className="mt-0.5 text-[18px] font-medium text-white">{value}</dd>
                </div>
              ))}
            </dl>

            <div className={`mt-5 rounded-xl bg-white/[0.04] p-5 ${reveal(summaryIn)}`}>
              <p className="text-[13px] font-semibold tracking-[0.1em] text-white/45 uppercase">
                {copy.summaryLabel}
              </p>
              <p className="mt-2 text-[19px] leading-snug text-white/85">{copy.summaryText}</p>
            </div>

            <div
              className={`mt-4 flex items-center justify-between gap-4 rounded-xl border p-5 transition-colors duration-500 ${
                confirmed ? "border-green/50 bg-green/10" : "border-orange/40 bg-orange/[0.07]"
              } ${reveal(requestIn)}`}
            >
              <div>
                <p className="text-[13px] font-semibold tracking-[0.1em] text-white/50 uppercase">
                  {copy.apptRequest}
                </p>
                <p className="mt-1 text-[22px] font-semibold text-white">{copy.apptValue}</p>
                <p
                  className={`mt-0.5 text-[16px] font-medium ${
                    confirmed ? "text-green" : "text-orange"
                  }`}
                >
                  {confirmed ? copy.visitConfirmed : copy.awaitingConfirm}
                </p>
              </div>
              <div className="relative">
                <span
                  className={`inline-flex rounded-lg px-6 py-3.5 text-[17px] font-semibold transition-all duration-200 ${
                    confirmed
                      ? "bg-green text-navy"
                      : "bg-orange text-navy"
                  } ${pressed && !confirmed ? "scale-95" : "scale-100"}`}
                >
                  {confirmed ? "✓" : copy.confirmVisit}
                </span>
                <Cursor shown={cursorIn} pressed={pressed} />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Cursor({ shown, pressed }: { shown: boolean; pressed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`pointer-events-none absolute h-8 w-8 drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)] transition-all duration-700 ease-out ${
        shown ? "right-6 bottom-1 opacity-100" : "-right-24 -bottom-24 opacity-0"
      } ${pressed ? "scale-90" : "scale-100"}`}
      aria-hidden
    >
      <path d="M4 2l15 9-6.5 1.6L9 19z" fill="white" stroke="#0c141e" strokeWidth="1.2" />
    </svg>
  );
}
