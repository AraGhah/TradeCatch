"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Service = {
  id?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bookingMode: "automatic" | "consultation" | "manual_approval" | "escalate";
  active: boolean;
  eligibleTechnicianIds: string[];
};

export function ServiceTypeEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.schedule");
  const [services, setServices] = useState<Service[]>([]);
  const [draft, setDraft] = useState<Service>({
    name: "",
    durationMinutes: 60,
    bookingMode: "automatic",
    active: true,
    eligibleTechnicianIds: [],
  });
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      fetch(`/api/businesses/${organizationId}/service-types`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Service types unavailable");
          return {
            response,
            data: (await response.json()) as { services?: Service[] },
          };
        })
        .then(({ data }) => {
          setServices(data.services ?? []);
        })
        .catch(() => setServices([])),
    [organizationId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function save(service: Service, isNew = false) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setMessageError(false);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/service-types`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...service,
            name: service.name.trim(),
            description: service.description?.trim() || undefined,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        service?: Service;
      };
      setMessageError(!res.ok);
      setMessage(
        res.ok
          ? t("saved")
          : data.code === "duplicate_name"
            ? t("duplicateService")
            : t("error"),
      );
      if (res.ok && data.service) {
        // Show the change at once; the reload below confirms it.
        const saved = data.service;
        setServices((rows) =>
          rows.some((row) => row.id === saved.id)
            ? rows.map((row) => (row.id === saved.id ? saved : row))
            : [...rows, saved],
        );
        if (isNew)
          setDraft({
            name: "",
            durationMinutes: 60,
            bookingMode: "automatic",
            active: true,
            eligibleTechnicianIds: [],
          });
      }
      await load();
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-navy/70">{t("servicesIntro")}</p>
      <ul className="divide-y divide-navy/10 rounded-md border border-navy/10 bg-white">
        {services.map((service) => (
          <li
            key={service.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <span>
              <span className="font-semibold text-navy">{service.name}</span>
              <span className="text-navy/60">
                {" "}
                · {service.durationMinutes} min ·{" "}
                {t(
                  service.bookingMode === "manual_approval"
                    ? "manual"
                    : service.bookingMode === "escalate"
                      ? "escalate"
                      : service.bookingMode,
                )}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span
                className={
                  service.active ? "text-green-800" : "text-navy/60"
                }
              >
                {service.active ? t("active") : t("inactive")}
              </span>
              <button
                type="button"
                disabled={busy}
                className="min-h-9 rounded-md border border-navy/20 px-3 py-1 font-semibold text-navy disabled:opacity-50"
                onClick={() =>
                  void save({ ...service, active: !service.active })
                }
              >
                {service.active ? t("deactivateService") : t("activateService")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 rounded-md border border-navy/10 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(draft, true);
        }}
      >
        <input
          required
          maxLength={160}
          aria-label={t("service")}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder={t("service")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          maxLength={500}
          aria-label={t("description")}
          value={draft.description ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, description: event.target.value })
          }
          placeholder={t("description")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          type="number"
          required
          min={15}
          max={480}
          step={5}
          aria-label={t("serviceDuration")}
          value={draft.durationMinutes}
          onChange={(event) =>
            setDraft({ ...draft, durationMinutes: Number(event.target.value) })
          }
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <select
          aria-label={t("mode")}
          value={draft.bookingMode}
          onChange={(event) =>
            setDraft({
              ...draft,
              bookingMode: event.target.value as Service["bookingMode"],
            })
          }
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        >
          <option value="automatic">{t("automatic")}</option>
          <option value="consultation">{t("consultation")}</option>
          <option value="manual_approval">{t("manual")}</option>
          <option value="escalate">{t("escalate")}</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("saving") : t("save")}
        </button>
      </form>
      {message ? (
        <p role={messageError ? "alert" : "status"} className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
