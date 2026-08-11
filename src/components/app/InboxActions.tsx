"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function InboxActions({ itemId }: { itemId: string }) {
  const t = useTranslations("app");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: "claim" | "resolve" | "takeover") {
    setBusy(true);
    try {
      await fetch("/api/app/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("claim")}
        className="rounded-md border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        {t("inbox.claim")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("takeover")}
        className="rounded-md border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        {t("inbox.takeover")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("resolve")}
        className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-navy/90 disabled:opacity-50"
      >
        {t("inbox.resolve")}
      </button>
    </div>
  );
}
