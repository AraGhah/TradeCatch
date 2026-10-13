"use client";

import { LogoMark } from "@/components/BrandLockup";
import { DEMO_DATA, sinceLine } from "../timeline";
import { Avatar, Panel, VoiceBars, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/** An emergency the business defined is bridged to the on-call line. */
export function TransferScene({ sec, scene, copy }: SceneProps) {
  const since = (line: number) => sinceLine(scene, sec, line);
  const handoffEnd = scene.segments[1]?.end ?? scene.duration;

  const emergency = since(0) >= 1;
  const agentLine = since(1) >= 0;
  const routing = since(1) >= 1.5;
  const ringing = sec >= handoffEnd - 0.6;
  const connected = sec >= handoffEnd + 0.9;
  const tagIn = since(2) >= 0;
  const speaking = scene.segments.findIndex(
    (s) => sec >= s.start && sec <= s.end,
  );

  const callerLine = scene.segments[0];
  const agentText = scene.segments[1];

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div
        className={`absolute inset-0 transition-opacity duration-700 ${
          emergency ? "opacity-100" : "opacity-0"
        } bg-[radial-gradient(ellipse_at_50%_20%,rgba(228,118,43,0.2),transparent_55%)]`}
      />

      <div className="relative z-10 w-full max-w-[1280px] -translate-y-[5vh] px-10">
        <div className="grid grid-cols-[1.2fr_0.8fr] items-start gap-8">
          <Panel className="p-7">
            <div className="flex items-center gap-4">
              <Avatar initials={DEMO_DATA.caller2Initials} size={52} />
              <div className="flex-1">
                <p className="text-[22px] font-semibold text-white">{DEMO_DATA.caller2}</p>
                <p className="font-mono text-[15px] text-white/50">{DEMO_DATA.caller2Phone}</p>
              </div>
              {speaking === 0 || speaking === 1 ? (
                <VoiceBars active tone={speaking === 1 ? "ember" : "white"} />
              ) : null}
            </div>
            <div className="mt-5 space-y-3">
              {callerLine ? (
                <p className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-[#1e6b47] px-5 py-3.5 text-[21px] leading-snug text-white">
                  {callerLine.text}
                </p>
              ) : null}
              {agentText ? (
                <p
                  className={`max-w-[88%] rounded-2xl rounded-tl-md bg-[#1e2a38] px-5 py-3.5 text-[21px] leading-snug text-white ${reveal(agentLine, "left")}`}
                >
                  <span className="mb-1 block text-[13px] font-semibold tracking-[0.08em] text-orange uppercase">
                    {copy.receptionist}
                  </span>
                  {agentText.text}
                </p>
              ) : null}
            </div>
          </Panel>

          <div
            className={`rounded-[22px] border-2 border-orange/60 bg-orange/[0.12] p-7 ${reveal(emergency, "right")}`}
          >
            <p className="flex items-center gap-3 text-[15px] font-semibold tracking-[0.12em] text-orange uppercase">
              <span className="animate-tc-pulse-ember h-3 w-3 rounded-full bg-orange" />
              {copy.emergencyDetected}
            </p>
            <p className="mt-3 font-heading text-[38px] leading-tight font-extrabold tracking-[-0.03em] text-white">
              {copy.emergencyType}
            </p>
          </div>
        </div>

        <div className="mt-10 flex items-center">
          <FlowNode label={DEMO_DATA.caller2} sub={copy.caller} active>
            <Avatar initials={DEMO_DATA.caller2Initials} size={60} />
          </FlowNode>
          <FlowLine filled={agentLine} />
          <FlowNode label={copy.receptionist} sub="TradeCatch" active={agentLine}>
            <LogoMark inverted className="!h-[60px] !w-[60px] !rounded-full" />
          </FlowNode>
          <FlowLine filled={routing} />
          <FlowNode
            label={`${copy.onCallTech} · ${DEMO_DATA.onCall}`}
            sub={
              connected
                ? copy.transferConnected
                : ringing
                  ? copy.transferRinging
                  : copy.transferringTo
            }
            active={routing}
            success={connected}
          >
            <div className="relative">
              {ringing && !connected ? (
                <span className="absolute inset-0 animate-ping rounded-full bg-green/40" />
              ) : null}
              <Avatar initials="MD" size={60} tone="ember" />
            </div>
          </FlowNode>
        </div>

        <p
          className={`mt-10 text-center font-heading text-[clamp(26px,2.6vw,36px)] font-extrabold tracking-[-0.03em] text-white ${reveal(tagIn)}`}
        >
          {copy.transferTag}
        </p>
      </div>
    </div>
  );
}

function FlowNode({
  children,
  label,
  sub,
  active,
  success = false,
}: {
  children: React.ReactNode;
  label: string;
  sub: string;
  active: boolean;
  success?: boolean;
}) {
  return (
    <div
      className={`flex w-[250px] shrink-0 flex-col items-center gap-3 text-center transition-opacity duration-500 ${
        active ? "opacity-100" : "opacity-35"
      }`}
    >
      {children}
      <p className="text-[18px] font-semibold text-white">{label}</p>
      <p
        className={`text-[15px] font-medium ${
          success ? "text-green" : "text-white/55"
        }`}
      >
        {sub}
      </p>
    </div>
  );
}

function FlowLine({ filled }: { filled: boolean }) {
  return (
    <div className="relative -mt-16 h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
      <div
        className={`absolute inset-0 origin-left bg-orange transition-transform duration-700 ease-out ${
          filled ? "scale-x-100" : "scale-x-0"
        }`}
      />
    </div>
  );
}
