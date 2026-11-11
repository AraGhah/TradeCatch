"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatSlotDate,
  formatSlotTime,
  pickerLocale,
  tidySentence,
} from "./schedule-picker-utils";

type Slot = { startAt: string; localLabel: string };
type Result = {
  error?: string;
  ok?: boolean;
  slots?: Slot[];
  confirmed?: boolean;
  reason?: string;
  appointment?: { id: string; startAt?: string; timezone?: string; simulated?: boolean };
};

export function AppointmentTestPanel({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.schedule");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const locale = pickerLocale(useLocale());
  // What happened, in sentences: the raw answer is of no use to an owner.
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastPracticeId, setLastPracticeId] = useState<string | null>(null);

  function describe(action: string, data: Result): string {
    if (data.error) return t("testError");
    if (action === "availability") {
      const found = data.slots ?? [];
      return found.length === 0
        ? t("testNoSlots")
        : tidySentence(
            t("testSlots", { count: found.length, first: found[0]!.localLabel }),
          );
    }
    if (action === "cancel") {
      return data.ok === false ? t("testError") : t("testWithdrawn");
    }
    const at = data.appointment?.startAt;
    const zone = data.appointment?.timezone;
    const when =
      at && zone
        ? `${formatSlotDate(at, zone, locale)}, ${formatSlotTime(at, zone, locale)}`
        : "";
    if (data.confirmed) return tidySentence(t("testConfirmed", { when }));
    if (data.reason === "conflict") return t("testConflict");
    if (data.reason?.startsWith("calendar")) return t("testCalendarFailed");
    return t("testNotConfirmed");
  }

  useEffect(() => {
    void fetch(`/api/businesses/${organizationId}/service-types`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        // A service that was switched off cannot be booked, so it is not offered.
        const services = (
          (data as { services?: { id: string; name: string; active?: boolean }[] }).services ?? []
        ).filter((service) => service.active !== false);
        setServices(services);
        setServiceId(services[0]?.id ?? "");
      });
  }, [organizationId]);

  async function post(action: string, extra?: Record<string, string>): Promise<Result> {
    try {
      const res = await fetch(`/api/businesses/${organizationId}/appointments/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, serviceId, ...extra }),
      });
      const data = (await res.json().catch(() => ({ error: "unreadable" }))) as Result;
      if (action === "availability" && Array.isArray(data.slots)) setSlots(data.slots);
      return data;
    } catch {
      return { error: "network" };
    }
  }

  /** Runs one or more practice calls and shows one sentence per answer. */
  async function run(action: string, extras: (Record<string, string> | undefined)[]) {
    if (busy) return;
    if (action !== "availability" && !slots[0]) {
      setLines([t("testCheckFirst")]);
      return;
    }
    setBusy(true);
    try {
      const results = await Promise.all(extras.map((extra) => post(action, extra)));
      const practiceId = results
        .map((row) => row.appointment?.id)
        .find(Boolean);
      if (practiceId && (action === "book" || action === "calendar_failure")) {
        setLastPracticeId(practiceId);
      }
      if (action === "cancel" && results.every((row) => row.ok !== false && !row.error)) {
        setLastPracticeId(null);
      }
      setLines(results.map((data) => describe(action, data)));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawPractice() {
    if (!lastPracticeId || busy) return;
    await run("cancel", [{ appointmentId: lastPracticeId }]);
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{t("testTitle")}</h2>
      <p className="text-sm text-navy/70">{t("testIntro")}</p>
      <select aria-label={t("service")} value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="max-w-sm rounded-md border border-navy/15 px-2 py-1.5 text-sm">
        {services.map((service) => (
          <option key={service.id} value={service.id}>{service.name}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void run("availability", [undefined])}>{t("check")}</button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          onClick={() => void run("book", [{ startAt: slots[0]?.startAt ?? "", customerName: "Test Customer A", customerPhoneE164: "+15145550100" }])}
        >
          {t("simulate")}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          onClick={() => {
            const startAt = slots[0]?.startAt ?? "";
            void run("book", [
              { startAt, customerName: "Test Customer A" },
              { startAt, customerName: "Test Customer B" },
            ]);
          }}
        >
          {t("double")}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          onClick={() => void run("calendar_failure", [{ startAt: slots[1]?.startAt || slots[0]?.startAt || "" }])}
        >
          {t("fail")}
        </button>
        <button
          type="button"
          disabled={busy || !lastPracticeId}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          onClick={() => void withdrawPractice()}
        >
          {t("withdrawPractice")}
        </button>
      </div>
      {lines.length > 0 ? (
        <ul role="status" className="list-disc rounded-md bg-navy/5 py-3 pl-8 pr-3 text-sm text-navy">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
