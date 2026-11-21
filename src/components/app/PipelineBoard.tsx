"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { PipelineCard, PipelineStage } from "@/product/growth";

import { timedFetch } from "@/lib/client/timed-fetch";
const STAGES: PipelineStage[] = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "booked",
  "won",
  "lost",
];

export function PipelineBoard({ cards }: { cards: PipelineCard[] }) {
  const t = useTranslations("app");
  const tFeedback = useTranslations("feedback");
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One move per card at a time, held synchronously: `busyId` only disables the
  // buttons after React re-renders, which is too late for a same-tick burst.
  // Other cards stay free to move meanwhile.
  const moving = useRef(new Set<string>());

  async function move(cardId: string, stage: PipelineStage) {
    if (moving.current.has(cardId)) return;
    moving.current.add(cardId);
    setBusyId(cardId);
    setError(null);
    try {
      const res = await timedFetch("/api/app/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          stage,
          recordRevenue: stage === "won",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("pipeline.error"));
        return;
      }
      router.refresh();
    } catch {
      // No answer: the card may or may not have moved. It is not shown as moved.
      setError(tFeedback("errors.networkUnknown"));
    } finally {
      moving.current.delete(cardId);
      setBusyId(null);
    }
  }

  if (cards.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
        {t("pipeline.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
        {cards.map((card) => (
          <li key={card.id} className="px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-navy">{card.title}</p>
              <p className="text-xs uppercase tracking-wide text-navy/50">
                {card.stage}
                {card.estimatedValue != null
                  ? ` · $${card.estimatedValue}`
                  : ""}
              </p>
            </div>
            <p className="mt-1 text-sm text-navy/70">
              {card.source}
              {card.customerPhoneE164 ? ` · ${card.customerPhoneE164}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STAGES.filter((s) => s !== card.stage).map((stage) => (
                <button
                  key={stage}
                  type="button"
                  disabled={busyId === card.id}
                  aria-busy={busyId === card.id}
                  onClick={() => void move(card.id, stage)}
                  className="rounded-md border border-navy/20 px-2 py-1 text-xs font-medium text-navy hover:bg-navy/5 disabled:opacity-50"
                >
                  {stage}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
