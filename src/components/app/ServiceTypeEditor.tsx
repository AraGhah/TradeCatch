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

  const load = useCallback(
    () =>
      fetch(`/api/businesses/${organizationId}/service-types`)
        .then(async (response) => ({
          response,
          data: (await response.json()) as { services?: Service[] },
        }))
        .then(({ data }) => {
          setServices(data.services ?? []);
        }),
    [organizationId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function save(service: Service) {
    const res = await fetch(`/api/businesses/${organizationId}/service-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(service),
    });
    setMessage(res.ok ? t("saved") : t("error"));
    await load();
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
            <button
              type="button"
              className="text-navy/70"
              onClick={() => void save({ ...service, active: !service.active })}
            >
              {service.active ? t("active") : t("canceled")}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 rounded-md border border-navy/10 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(draft);
        }}
      >
        <input
          required
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder={t("service")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          value={draft.description ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, description: event.target.value })
          }
          placeholder={t("description")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          type="number"
          value={draft.durationMinutes}
          onChange={(event) =>
            setDraft({ ...draft, durationMinutes: Number(event.target.value) })
          }
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <select
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
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
        >
          {t("save")}
        </button>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
