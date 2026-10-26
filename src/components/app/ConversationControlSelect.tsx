"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ConversationControl } from "@/product/crm/types";

const CONTROLS: ConversationControl[] = [
  "ai_managed",
  "human_managed",
  "automation_paused",
  "closed",
];

export function ConversationControlSelect({
  organizationId,
  conversationId,
  control,
}: {
  organizationId: string;
  conversationId: string;
  control: ConversationControl;
}) {
  const t = useTranslations("app.crm");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onChange(next: string) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ control: next }),
        },
      );
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={t("control")}
        defaultValue={control}
        disabled={busy}
        onChange={(e) => void onChange(e.target.value)}
        className="rounded-md border border-navy/20 px-2 py-1 text-xs disabled:opacity-50"
      >
        {CONTROLS.map((item) => (
          <option key={item} value={item}>
            {t(`controls.${item}`)}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {t("controlError")}
        </p>
      ) : null}
    </div>
  );
}
