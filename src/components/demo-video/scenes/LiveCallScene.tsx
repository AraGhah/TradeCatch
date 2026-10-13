"use client";

import { sinceLine } from "../timeline";
import { Avatar, Panel, VoiceBars, callClock, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/**
 * The receptionist's call, line by line as it is spoken, with the job details
 * filling in beside it. It ends on an appointment *request* the team confirms.
 */
export function LiveCallScene({ sec, scene, copy }: SceneProps) {
  const since = (line: number) => sinceLine(scene, sec, line);
  const lines = scene.segments
    .map((segment, i) => ({ ...segment, i }))
    .filter((line) => since(line.i) >= -0.05);
  const speaking = scene.segments.findIndex(
    (s) => sec >= s.start && sec <= s.end,
  );

  const fields = [
    { label: copy.fieldService, value: copy.valueService, shown: since(1) >= 1.8 },
    { label: copy.fieldArea, value: copy.valueArea, shown: since(2) >= 1.2 },
    { label: copy.fieldUrgency, value: copy.valueUrgency, shown: since(3) >= 0.8 },
    { label: copy.fieldTime, value: copy.valueTime, shown: since(5) >= 0.8 },
    { label: copy.fieldNext, value: copy.valueNext, shown: since(6) >= 2.5 },
  ];
  const tags = [
    since(2) >= 0.5,
    since(3) >= 1,
    since(6) >= 2,
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(47,158,104,0.1),transparent_50%),radial-gradient(ellipse_at_85%_70%,rgba(228,118,43,0.1),transparent_50%)]" />

      <div className="relative z-10 grid w-full max-w-[1420px] -translate-y-[4vh] grid-cols-[1.15fr_0.85fr] gap-8 px-10">
        <Panel className="flex h-[min(70vh,720px)] flex-col overflow-hidden">
          <div className="flex items-center gap-4 border-b border-white/10 px-7 py-5">
            <Avatar initials={copy.callerInitials} size={52} />
            <div className="min-w-0 flex-1">
              <p className="text-[22px] font-semibold text-white">{copy.callerName}</p>
              <p className="flex items-center gap-2 text-[15px] text-green">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green" />
                {copy.onCall}
              </p>
            </div>
            <span className="font-mono text-[20px] text-white/60 tabular-nums">
              {callClock(sec)}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden px-7 py-6 [mask-image:linear-gradient(to_bottom,transparent,black_14%)]">
            {lines.map((line) => {
              const agent = line.voice === "agent";
              const active = line.i === speaking;
              return (
                <div
                  key={line.i}
                  className={`flex animate-[fade-rise_0.35s_ease-out] flex-col ${
                    agent ? "items-start" : "items-end"
                  }`}
                >
                  <span
                    className={`mb-1.5 flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase ${
                      agent ? "text-orange" : "text-white/50"
                    }`}
                  >
                    {agent ? copy.receptionist : copy.caller}
                    {active ? (
                      <VoiceBars active tone={agent ? "ember" : "white"} bars={4} />
                    ) : null}
                  </span>
                  <p
                    className={`max-w-[86%] rounded-2xl px-5 py-3.5 text-[21px] leading-snug transition-opacity duration-300 ${
                      agent
                        ? "rounded-tl-md bg-[#1e2a38] text-white"
                        : "rounded-tr-md bg-[#1e6b47] text-white"
                    } ${active || line.i === lines.length - 1 ? "opacity-100" : "opacity-60"}`}
                  >
                    {line.text}
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="flex flex-col">
          <Panel className="p-7">
            <p className="font-mono text-[14px] tracking-[0.14em] text-white/45 uppercase">
              {copy.capturedTitle}
            </p>
            <dl className="mt-4">
              {fields.map((field) => (
                <div
                  key={field.label}
                  className="flex items-center justify-between gap-4 border-t border-white/[0.08] py-3.5"
                >
                  <dt className="text-[16px] text-white/50">{field.label}</dt>
                  <dd
                    className={`flex items-center gap-2.5 text-right text-[19px] font-semibold transition-all duration-500 ${
                      field.shown ? "text-white" : "text-white/20"
                    }`}
                  >
                    {field.shown ? field.value : "…"}
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[12px] transition-all duration-300 ${
                        field.shown
                          ? "scale-100 bg-green text-navy"
                          : "scale-50 bg-white/10 text-transparent"
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <div className="mt-5 flex flex-wrap gap-2.5">
            {copy.liveTags.map((tag, i) => (
              <span
                key={tag}
                className={`rounded-full border px-4 py-2 text-[16px] font-semibold ${
                  tags[i]
                    ? "border-orange/50 bg-orange/15 text-orange"
                    : "border-white/10 bg-white/[0.03] text-white/30"
                } ${reveal(tags[i])}`}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
