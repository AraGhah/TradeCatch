"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { BusyLabel } from "@/components/ui/Spinner";

import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
export function InboxActions({ itemId }: { itemId: string }) {
  const t = useTranslations("app");
  const tFeedback = useTranslations("feedback");
  const router = useRouter();
  // Which action is running: that button says "Working…", the others are just disabled.
  const [acting, setActing] = useState<"claim" | "resolve" | "takeover" | null>(null);
  const busy = acting !== null;
  const [error, setError] = useState<string | null>(null);

  const run = useGuarded(runHandler);
  async function runHandler(action: "claim" | "resolve" | "takeover") {
    if (busy) return;
    setActing(action);
    setError(null);
    try {
      const response = await timedFetch("/api/app/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action }),
      });
      if (!response.ok) {
        setError(t(`inbox.${action}Error`));
        return;
      }
      router.refresh();
    } catch {
      setError(t(`inbox.${action}Error`));
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2" aria-busy={busy}>
      <button
        type="button"
        disabled={busy}
        aria-busy={acting === "claim"}
        onClick={() => void run("claim")}
        className="rounded-md border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        <BusyLabel pending={acting === "claim"} busyLabel={tFeedback("working")}>
          {t("inbox.claim")}
        </BusyLabel>
      </button>
      <button
        type="button"
        disabled={busy}
        aria-busy={acting === "takeover"}
        onClick={() => void run("takeover")}
        className="rounded-md border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        <BusyLabel pending={acting === "takeover"} busyLabel={tFeedback("working")}>
          {t("inbox.takeover")}
        </BusyLabel>
      </button>
      <button
        type="button"
        disabled={busy}
        aria-busy={acting === "resolve"}
        onClick={() => void run("resolve")}
        className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-navy/90 disabled:opacity-50"
      >
        <BusyLabel pending={acting === "resolve"} busyLabel={tFeedback("working")}>
          {t("inbox.resolve")}
        </BusyLabel>
      </button>
      {error ? (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
