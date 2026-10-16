"use client";

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

  async function onChange(next: string) {
    await fetch(
      `/api/businesses/${organizationId}/conversations/${conversationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control: next }),
      },
    );
    router.refresh();
  }

  return (
    <select
      aria-label={t("control")}
      defaultValue={control}
      onChange={(e) => void onChange(e.target.value)}
      className="rounded-md border border-navy/20 px-2 py-1 text-xs"
    >
      {CONTROLS.map((item) => (
        <option key={item} value={item}>
          {t(`controls.${item}`)}
        </option>
      ))}
    </select>
  );
}
