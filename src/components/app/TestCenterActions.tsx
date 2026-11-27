"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { ActionButton } from "@/components/ui/ActionButton";

export function TestCenterActions({
  organizationId,
  isDemo,
  isAdmin,
}: {
  organizationId: string;
  isDemo: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("app.testCenter");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const flight = useSingleFlight();
  const [acting, setActing] = useState<"seed" | "reset" | null>(null);
  const busy = flight.pending;

  async function seedHandler() {
    setActing("seed");
    setError(null);
    setMessage(null);
    setSeeded(false);
    setResetDone(false);
    try {
      const res = await timedFetch(
        `/api/admin/demo-businesses/${organizationId}/seed`,
        { method: "POST" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("seedFailed"));
        return;
      }
      setSeeded(true);
      setMessage(t("seedOk"));
    } catch {
      setError(t("seedFailed"));
    } finally {
      setActing(null);
    }
  }

  async function resetHandler() {
    if (!window.confirm(t("confirmReset"))) return;
    setActing("reset");
    setError(null);
    setMessage(null);
    setSeeded(false);
    setResetDone(false);
    try {
      const res = await timedFetch(
        `/api/admin/demo-businesses/${organizationId}/reset`,
        {
          method: "POST",
          timeoutMs: 60_000,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: "RESET_DEMO_ACCOUNT", reseed: true }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("resetFailed"));
        return;
      }
      setResetDone(true);
      setMessage(t("resetOk"));
    } catch {
      setError(t("resetFailed"));
    } finally {
      setActing(null);
    }
  }

  if (!isDemo) {
    return (
      <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy/70">
        {t("notDemo")}
      </p>
    );
  }

  if (!isAdmin) {
    return (
      <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy/70">
        {t("adminOnly")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <ActionButton
          type="button"
          pending={acting === "seed"}
          busyLabel={t("generatingData")}
          success={seeded}
          successLabel={t("generated")}
          disabled={busy && acting !== "seed"}
          onClick={() => void flight.run(seedHandler)}
          className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white"
        >
          {t("generateData")}
        </ActionButton>
        <ActionButton
          type="button"
          pending={acting === "reset"}
          busyLabel={t("resettingAccount")}
          success={resetDone}
          successLabel={t("resetDone")}
          disabled={busy && acting !== "reset"}
          onClick={() => void flight.run(resetHandler)}
          className="rounded-md border border-navy/20 px-4 py-2.5 text-sm font-semibold text-navy"
        >
          {t("resetAccount")}
        </ActionButton>
      </div>
      <p className="text-xs text-navy/50">{t("safetyNote")}</p>
    </div>
  );
}
