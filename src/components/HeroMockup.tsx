"use client";

import { useEffect, useRef, useState } from "react";

type Msg = {
  type: "event" | "out" | "in" | "photo" | "win";
  text: string;
  time?: string;
};

/** Per-message timing tuned so a full cycle lands ~8–12s before restart. */
const TIMING: { think?: number; after: number }[] = [
  { after: 500 },
  { think: 700, after: 900 },
  { think: 650, after: 850 },
  { think: 700, after: 900 },
  { after: 750 },
  { think: 500, after: 700 },
  { after: 650 },
  { after: 900 },
];

const RESTART_PAUSE_MS = 2200;

export function HeroMockup({
  businessName,
  avatar,
  autoReply,
  statusTime,
  statusNetwork,
  disclaimer,
  floatLabel,
  floatTitle,
  messages,
}: {
  businessName: string;
  avatar: string;
  autoReply: string;
  statusTime: string;
  statusNetwork: string;
  disclaimer: string;
  floatLabel: string;
  floatTitle: string;
  messages: Msg[];
}) {
  const [shown, setShown] = useState<Msg[]>([]);
  const [typing, setTyping] = useState<"out" | "in" | null>(null);
  const [parallax, setParallax] = useState(0);
  const [floatVisible, setFloatVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const timers = useRef<number[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId: number | null = null;
    function sync() {
      setReduceMotion(media.matches);
      if (media.matches) setParallax(0);
    }
    media.addEventListener("change", sync);

    function onScroll() {
      if (media.matches || frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        setParallax(Math.min(window.scrollY, 1200));
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const clearTimers = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };

    function delay(ms: number) {
      const d = reduceMotion ? Math.min(ms, 120) : ms;
      return new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          timers.current = timers.current.filter((t) => t !== id);
          resolve();
        }, d);
        timers.current.push(id);
      });
    }

    async function run() {
      while (!cancelled) {
        setShown([]);
        setTyping(null);
        setFloatVisible(false);

        if (reduceMotion) {
          setShown(messages);
          setFloatVisible(true);
          await delay(4000);
          continue;
        }

        for (let i = 0; i < messages.length; i++) {
          if (cancelled) return;
          const msg = messages[i];
          const timing = TIMING[i] ?? { after: 800 };
          const beat = { ...msg, ...timing };

          if (beat.think && (beat.type === "out" || beat.type === "in")) {
            setTyping(beat.type);
            await delay(beat.think);
            if (cancelled) return;
            setTyping(null);
          }

          setShown((prev) => [...prev, msg]);
          if (msg.type === "event" && /ALERT|ALERTÉ|ALERTED/i.test(msg.text)) {
            setFloatVisible(true);
          }
          if (msg.type === "win") setFloatVisible(true);
          await delay(beat.after);
        }
        await delay(RESTART_PAUSE_MS);
      }
    }

    run();
    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [messages, reduceMotion]);

  const staticDescription = messages
    .map((m) => m.text)
    .filter(Boolean)
    .slice(0, 6)
    .join(" · ");

  return (
    <div
      id="missed-call-demo"
      className="relative mx-auto w-full max-w-[384px] scroll-mt-28"
      style={{
        transform: reduceMotion
          ? undefined
          : `translateY(${parallax * -0.045}px)`,
      }}
    >
      <p className="sr-only">{staticDescription || disclaimer}</p>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-[520px] w-[520px] rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle, rgba(228,118,43,0.35) 0%, transparent 70%)",
        }}
      />

      <div
        className="relative rounded-[46px] p-[11px]"
        style={{
          background: "linear-gradient(160deg,#2A3846,#141F2B 55%,#0A1017)",
          boxShadow:
            "0 60px 90px -50px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.07)",
        }}
      >
        <div
          className="flex flex-col overflow-hidden rounded-[36px] bg-paper"
          style={{ height: "min(660px, 72vh)" }}
        >
          <div className="relative flex items-center justify-between bg-white px-4 pb-3 pt-3.5">
            <div className="absolute left-1/2 top-1.5 h-[22px] w-[88px] -translate-x-1/2 rounded-full bg-navy/90" />
            <span className="font-mono text-[11px] font-medium text-navy">
              {statusTime}
            </span>
            <span className="font-mono text-[10px] text-muted">{statusNetwork}</span>
          </div>

          <div className="flex items-center gap-3 border-b border-[rgba(12,20,30,0.08)] bg-white px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy font-heading text-[12px] font-bold text-white">
              {avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-navy">
                {businessName}
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-signal-text">
                <span className="h-1.5 w-1.5 animate-tc-pulse rounded-full bg-green" />
                {autoReply}
              </p>
            </div>
          </div>

          <div
            ref={threadRef}
            className="flex flex-1 flex-col justify-end gap-2.5 overflow-hidden px-[18px] py-4"
            aria-hidden="true"
          >
            {shown.map((msg, i) => (
              <MessageBubble
                key={`${msg.type}-${i}-${msg.text.slice(0, 16)}`}
                msg={msg}
              />
            ))}
            {typing ? <TypingDots side={typing} /> : null}
          </div>

          <p className="border-t border-[rgba(12,20,30,0.08)] px-4 py-2.5 text-center font-mono text-[10px] tracking-[0.04em] text-muted">
            {disclaimer}
          </p>
        </div>
      </div>

      <div
        className={`absolute bottom-[54px] left-[-8px] z-10 rounded-[14px] border border-[rgba(12,20,30,0.1)] bg-white px-4 py-3 shadow-card-hover transition-[opacity,transform] duration-500 ${
          floatVisible
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0"
        }`}
        aria-hidden={!floatVisible}
      >
        <p className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
          {floatLabel}
        </p>
        <p className="mt-0.5 text-[14px] font-semibold text-navy">{floatTitle}</p>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.type === "event" || msg.type === "win") {
    const win = msg.type === "win";
    return (
      <div
        className={`animate-tc-in flex w-full items-center gap-2 rounded-full px-3 py-2 ${
          win
            ? "border border-green/30 bg-[rgba(47,158,104,0.1)]"
            : "bg-[rgba(12,20,30,0.05)]"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            win ? "bg-green" : "bg-muted"
          }`}
        />
        <span
          className={`flex-1 font-mono text-[10.5px] font-medium tracking-[0.04em] ${
            win ? "text-signal-text" : "text-secondary"
          }`}
        >
          {msg.text}
        </span>
        {msg.time ? (
          <span className="font-mono text-[10px] text-muted">{msg.time}</span>
        ) : null}
      </div>
    );
  }

  if (msg.type === "photo") {
    return (
      <div className="animate-tc-in max-w-[78%] self-end overflow-hidden rounded-[16px] rounded-br-[5px] border border-[rgba(12,20,30,0.1)] bg-white shadow-[0_8px_20px_-14px_rgba(12,20,30,0.35)]">
        <div
          className="relative flex h-[108px] items-end justify-start bg-[linear-gradient(145deg,#3A4A5A_0%,#1A2430_55%,#0C141E_100%)] px-3 pb-2.5"
          aria-hidden
        >
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_30%_40%,rgba(228,118,43,0.45),transparent_45%),radial-gradient(circle_at_70%_70%,rgba(255,255,255,0.12),transparent_40%)]" />
          <span className="relative rounded bg-black/45 px-2 py-0.5 font-mono text-[9px] tracking-[0.06em] text-white/90 uppercase">
            MMS
          </span>
        </div>
        <p className="px-3 py-2 text-[12.5px] font-medium text-navy">{msg.text}</p>
      </div>
    );
  }

  if (msg.type === "out") {
    return (
      <div className="animate-tc-in max-w-[88%] self-start rounded-[18px] rounded-bl-[5px] border border-[rgba(12,20,30,0.08)] bg-white px-3.5 py-2.5 text-[13.5px] leading-snug text-navy">
        {msg.text}
      </div>
    );
  }

  return (
    <div className="animate-tc-in max-w-[86%] self-end rounded-[18px] rounded-br-[5px] bg-navy px-3.5 py-2.5 text-[13.5px] leading-snug text-white">
      {msg.text}
    </div>
  );
}

function TypingDots({ side }: { side: "out" | "in" }) {
  return (
    <div
      className={`flex gap-1 px-3 py-2 ${
        side === "out" ? "self-start" : "self-end"
      }`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            side === "out" ? "bg-muted" : "bg-navy/40"
          } animate-tc-blink`}
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  );
}
