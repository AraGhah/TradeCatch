"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function SimulateLeadButton({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.crm");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/leads/simulate`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        leadId?: string;
      };
      if (!res.ok || !data.leadId) {
        setError(data.error || t("error"));
        return;
      }
      setLeadId(data.leadId);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="self-start rounded-md border border-navy/15 bg-white px-4 py-3 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        {busy ? t("saving") : t("simulate")}
      </button>
      {leadId ? (
        <p className="text-sm text-navy/80">
          {t("simulateOk")}{" "}
          <Link
            href={{ pathname: "/app/leads/[id]", params: { id: leadId } }}
            className="font-semibold underline"
          >
            {t("detail")}
          </Link>
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
