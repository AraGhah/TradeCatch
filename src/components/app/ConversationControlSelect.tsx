"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { InlineStatus } from "@/components/ui/Spinner";
import type { ConversationControl } from "@/product/crm/types";

import { timedFetch } from "@/lib/client/timed-fetch";
import { useGuarded } from "@/lib/client/use-single-flight";

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
  const tFeedback = useTranslations("feedback");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // What the server has: the select shows this, not the option merely clicked,
  // so a change that did not save is not left looking as though it had.
  const [saved, setSaved] = useState(control);

  const onChange = useGuarded(onChangeHandler);
  async function onChangeHandler(next: string) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await timedFetch(
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
      setSaved(next as ConversationControl);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("control")}
        value={saved}
        disabled={busy}
        aria-busy={busy}
        onChange={(e) => void onChange(e.target.value)}
        className="rounded-md border border-navy/20 px-2 py-1 text-xs disabled:opacity-50"
      >
        {CONTROLS.map((item) => (
          <option key={item} value={item}>
            {t(`controls.${item}`)}
          </option>
        ))}
      </select>
      {busy ? <InlineStatus className="text-xs">{tFeedback("saving")}</InlineStatus> : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {t("controlError")}
        </p>
      ) : null}
    </div>
  );
}
