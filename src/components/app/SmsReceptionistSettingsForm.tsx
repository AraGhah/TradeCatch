"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type TechnicianRosterEntry = {
  id: string;
  name: string;
  phone: string;
  role: "primary" | "backup" | "owner";
  active: boolean;
};

type BusinessHours = { start: string; end: string; days: number[] };

export type SmsReceptionistSettingsValue = {
  contractorDisplayName: string;
  timezone: string;
  businessHours: BusinessHours;
  technicianRoster: TechnicianRosterEntry[];
  humanReviewPhone: string | null;
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
let draftIdCounter = 0;

export function SmsReceptionistSettingsForm({
  smsFromNumber,
  initial,
  canEdit,
}: {
  smsFromNumber: string;
  initial: SmsReceptionistSettingsValue;
  canEdit: boolean;
}) {
  const t = useTranslations("app.smsReceptionist");
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function updateTechnician(
    id: string,
    patch: Partial<TechnicianRosterEntry>,
  ) {
    setValue((prev) => ({
      ...prev,
      technicianRoster: prev.technicianRoster.map((tech) =>
        tech.id === id ? { ...tech, ...patch } : tech,
      ),
    }));
  }

  function addTechnician() {
    const draftId = `draft_${draftIdCounter++}`;
    setValue((prev) => ({
      ...prev,
      technicianRoster: [
        ...prev.technicianRoster,
        { id: draftId, name: "", phone: "", role: "backup", active: true },
      ],
    }));
  }

  function removeTechnician(id: string) {
    setValue((prev) => ({
      ...prev,
      technicianRoster: prev.technicianRoster.filter((tech) => tech.id !== id),
    }));
  }

  function toggleDay(day: number) {
    setValue((prev) => {
      const days = prev.businessHours.days.includes(day)
        ? prev.businessHours.days.filter((d) => d !== day)
        : [...prev.businessHours.days, day].sort();
      return { ...prev, businessHours: { ...prev.businessHours, days } };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/app/sms-receptionist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractorDisplayName: value.contractorDisplayName,
          timezone: value.timezone,
          businessHours: value.businessHours,
          technicianRoster: value.technicianRoster.map((tech) => ({
            // Draft rows have no real id yet — the server assigns one.
            id: tech.id.startsWith("draft_") ? undefined : tech.id,
            name: tech.name,
            phone: tech.phone,
            role: tech.role,
            active: tech.active,
          })),
          humanReviewPhone: value.humanReviewPhone || undefined,
        }),
      });
      const payload = (await response.json()) as
        | (SmsReceptionistSettingsValue & { ok: true })
        | { error: string; issues?: unknown };
      if (!response.ok || !("ok" in payload)) {
        setError(
          ("error" in payload && payload.error) || t("error"),
        );
        return;
      }
      setValue({
        contractorDisplayName: payload.contractorDisplayName,
        timezone: payload.timezone,
        businessHours: payload.businessHours,
        technicianRoster: payload.technicianRoster,
        humanReviewPhone: payload.humanReviewPhone,
      });
      setSaved(true);
    } catch {
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("number")}
        </p>
        <p className="mt-1 text-sm text-navy">{smsFromNumber}</p>
        <p className="mt-1 text-xs text-navy/50">{t("numberNote")}</p>
      </div>

      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("businessName")}
        <input
          value={value.contractorDisplayName}
          disabled={!canEdit}
          onChange={(e) =>
            setValue((prev) => ({
              ...prev,
              contractorDisplayName: e.target.value,
            }))
          }
          className="rounded-md border border-navy/20 px-2 py-1.5 disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("timezone")}
        <input
          value={value.timezone}
          disabled={!canEdit}
          onChange={(e) =>
            setValue((prev) => ({ ...prev, timezone: e.target.value }))
          }
          placeholder="America/Toronto"
          className="rounded-md border border-navy/20 px-2 py-1.5 disabled:opacity-60"
        />
      </label>

      <div>
        <p className="mb-1 text-sm text-navy">{t("businessHours")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            value={value.businessHours.start}
            disabled={!canEdit}
            onChange={(e) =>
              setValue((prev) => ({
                ...prev,
                businessHours: { ...prev.businessHours, start: e.target.value },
              }))
            }
            className="rounded-md border border-navy/20 px-2 py-1.5 disabled:opacity-60"
          />
          <span className="text-navy/50">{t("to")}</span>
          <input
            type="time"
            value={value.businessHours.end}
            disabled={!canEdit}
            onChange={(e) =>
              setValue((prev) => ({
                ...prev,
                businessHours: { ...prev.businessHours, end: e.target.value },
              }))
            }
            className="rounded-md border border-navy/20 px-2 py-1.5 disabled:opacity-60"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <label
              key={day}
              className="flex items-center gap-1 text-xs text-navy/70"
            >
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={value.businessHours.days.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {t(`day.${day}`)}
            </label>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("humanReviewPhone")}
        <input
          value={value.humanReviewPhone ?? ""}
          disabled={!canEdit}
          onChange={(e) =>
            setValue((prev) => ({
              ...prev,
              humanReviewPhone: e.target.value,
            }))
          }
          placeholder="+15145550100"
          className="rounded-md border border-navy/20 px-2 py-1.5 disabled:opacity-60"
        />
      </label>

      <div>
        <p className="mb-2 text-sm text-navy">{t("roster")}</p>
        <ul className="flex flex-col gap-2">
          {value.technicianRoster.map((tech) => (
            <li
              key={tech.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-navy/15 bg-white px-3 py-2"
            >
              <input
                value={tech.name}
                disabled={!canEdit}
                onChange={(e) =>
                  updateTechnician(tech.id, { name: e.target.value })
                }
                placeholder={t("namePlaceholder")}
                className="min-w-[140px] flex-1 rounded-md border border-navy/20 px-2 py-1 text-sm disabled:opacity-60"
              />
              <input
                value={tech.phone}
                disabled={!canEdit}
                onChange={(e) =>
                  updateTechnician(tech.id, { phone: e.target.value })
                }
                placeholder="+15145550100"
                className="min-w-[140px] flex-1 rounded-md border border-navy/20 px-2 py-1 text-sm disabled:opacity-60"
              />
              <select
                value={tech.role}
                disabled={!canEdit}
                onChange={(e) =>
                  updateTechnician(tech.id, {
                    role: e.target.value as TechnicianRosterEntry["role"],
                  })
                }
                className="rounded-md border border-navy/20 px-2 py-1 text-sm disabled:opacity-60"
              >
                <option value="primary">{t("rolePrimary")}</option>
                <option value="backup">{t("roleBackup")}</option>
                <option value="owner">{t("roleOwner")}</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-navy/70">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={tech.active}
                  onChange={(e) =>
                    updateTechnician(tech.id, { active: e.target.checked })
                  }
                />
                {t("active")}
              </label>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => removeTechnician(tech.id)}
                  className="rounded-md border border-navy/20 px-2 py-1 text-xs font-semibold text-navy"
                >
                  {t("remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <button
            type="button"
            onClick={addTechnician}
            className="mt-2 rounded-md border border-dashed border-navy/30 px-3 py-1.5 text-xs font-semibold text-navy"
          >
            {t("addTechnician")}
          </button>
        ) : null}
      </div>

      {canEdit ? (
        <div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
          {saved ? (
            <span className="ml-3 text-sm text-navy/70">{t("saved")}</span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-navy">
          {error}
        </p>
      ) : null}
    </div>
  );
}
