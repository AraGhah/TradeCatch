"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Technician = {
  id: string;
  name: string;
  serviceArea?: string;
  active: boolean;
};

export function TeamCalendarsPanel({
  initialTechnicians,
  calendarLimit,
}: {
  initialTechnicians: Technician[];
  calendarLimit: number;
}) {
  const t = useTranslations("app.team");
  const [technicians, setTechnicians] = useState(initialTechnicians);
  const [name, setName] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCount = technicians.filter((tech) => tech.active).length;
  const atLimit = activeCount >= calendarLimit;

  async function upsert(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/app/team/technicians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        technician?: Technician;
        error?: string;
      };
      if (!response.ok || !payload.technician) {
        setError(payload.error || t("error"));
        return;
      }
      setTechnicians((prev) => {
        const next = prev.filter((tech) => tech.id !== payload.technician!.id);
        return [...next, payload.technician!].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      });
      return payload.technician;
    } catch {
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  async function addTechnician() {
    if (!name.trim()) return;
    const created = await upsert({ name, serviceArea: serviceArea || undefined });
    if (created) {
      setName("");
      setServiceArea("");
    }
  }

  async function toggleActive(tech: Technician) {
    await upsert({ id: tech.id, name: tech.name, active: !tech.active });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {technicians.map((tech) => (
          <li
            key={tech.id}
            className="flex items-center justify-between rounded-md border border-navy/15 bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-semibold text-navy">{tech.name}</p>
              {tech.serviceArea ? (
                <p className="text-xs text-navy/60">{tech.serviceArea}</p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void toggleActive(tech)}
              className="rounded-md border border-navy/20 px-2 py-1 text-xs font-semibold text-navy disabled:opacity-60"
            >
              {tech.active ? t("deactivate") : t("activate")}
            </button>
          </li>
        ))}
        {technicians.length === 0 ? (
          <li className="text-sm text-navy/60">{t("empty")}</li>
        ) : null}
      </ul>

      <div className="rounded-md border border-dashed border-navy/20 p-3">
        <p className="mb-2 text-sm text-navy/70">
          {atLimit ? t("limitReached", { limit: calendarLimit }) : t("addIntro")}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            disabled={atLimit || saving}
            className="min-w-[160px] flex-1 rounded-md border border-navy/20 px-2 py-1.5 text-sm"
          />
          <input
            value={serviceArea}
            onChange={(event) => setServiceArea(event.target.value)}
            placeholder={t("areaPlaceholder")}
            disabled={atLimit || saving}
            className="min-w-[160px] flex-1 rounded-md border border-navy/20 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={atLimit || saving || !name.trim()}
            onClick={() => void addTechnician()}
            className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? t("saving") : t("add")}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-navy">
          {error}
        </p>
      ) : null}
    </div>
  );
}
