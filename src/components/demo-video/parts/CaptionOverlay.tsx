"use client";

import type { ReactNode } from "react";
import { captionAt, type DemoLocale } from "../timeline";

function renderWithHighlights(text: string, highlights: string[] = []) {
  if (!highlights.length) return text;
  let remaining = text;
  const parts: ReactNode[] = [];
  let key = 0;
  for (const h of highlights) {
    const idx = remaining.toLowerCase().indexOf(h.toLowerCase());
    if (idx === -1) continue;
    if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    parts.push(
      <span key={key++} className="text-orange">
        {remaining.slice(idx, idx + h.length)}
      </span>,
    );
    remaining = remaining.slice(idx + h.length);
  }
  if (remaining) parts.push(<span key={key++}>{remaining}</span>);
  return parts.length ? parts : text;
}

export function CaptionOverlay({
  timeSec,
  locale,
  raised = false,
}: {
  timeSec: number;
  locale: DemoLocale;
  raised?: boolean;
}) {
  const cue = captionAt(timeSec, locale);
  if (!cue) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-40 flex justify-center px-8 ${
        raised ? "bottom-[14%]" : "bottom-[7%]"
      }`}
    >
      <p className="max-w-[920px] rounded-md bg-[rgba(12,20,30,0.78)] px-5 py-2.5 text-center font-sans text-[clamp(18px,1.7vw,24px)] leading-snug font-medium text-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)]">
        {renderWithHighlights(cue.text, cue.highlights)}
      </p>
    </div>
  );
}
