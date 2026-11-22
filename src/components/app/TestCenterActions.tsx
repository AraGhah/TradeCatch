"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { BusyLabel } from "@/components/ui/Spinner";
import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
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
  const tFeedback = useTranslations("feedback");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Seeding and resetting the same demo account must never overlap: one lock for both.
  const flight = useSingleFlight();
  const [acting, setActing] = useState<"seed" | "reset" | null>(null);

  const seed = () =>
    flight.run(async () => {
      setError(null);
      setMessage(null);
      setActing("seed");
      try {
        const res = await timedFetch(
          `/api/admin/demo-businesses/${organizationId}/seed`,
          { method: "POST" },
        );
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(json.error || t("seedFailed"));
          return;
        }
        setMessage(t("seedOk"));
      } catch {
        setError(t("seedFailed"));
      } finally {
        setActing(null);
      }
    });

  const reset = () =>
    flight.run(async () => {
      if (!window.confirm(t("confirmReset"))) return;
      setError(null);
      setMessage(null);
      setActing("reset");
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
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(json.error || t("resetFailed"));
          return;
        }
        setMessage(t("resetOk"));
      } catch {
        setError(t("resetFailed"));
      } finally {
        setActing(null);
      }
    });

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
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void seed()}
          disabled={flight.pending}
          aria-busy={acting === "seed"}
          className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <BusyLabel pending={acting === "seed"} busyLabel={tFeedback("working")}>{t("generateData")}</BusyLabel>
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={flight.pending}
          aria-busy={acting === "reset"}
          className="rounded-md border border-navy/20 px-4 py-2.5 text-sm font-semibold text-navy disabled:opacity-50"
        >
          <BusyLabel pending={acting === "reset"} busyLabel={tFeedback("working")}>{t("resetAccount")}</BusyLabel>
        </button>
      </div>
      <p className="text-xs text-navy/50">{t("safetyNote")}</p>
    </div>
  );
}
