"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_CHANNELS } from "@/product/notifications/templates";
import type { PreferenceCategory } from "@/product/notifications/types";

const KEYS = Object.keys(DEFAULT_CHANNELS) as PreferenceCategory[];

type Prefs = {
  categories: Record<PreferenceCategory, { inApp: boolean; email: boolean; sms: boolean }>;
  quietStart: string;
  quietEnd: string;
  quietEnabled: boolean;
  language: "en" | "fr";
  dailySummary: boolean;
  scope: "all" | "assigned";
};

export function NotificationPreferencesForm({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.alerts");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/businesses/${organizationId}/notification-preferences`)
      .then((res) => res.json())
      .then((data) => setPrefs((data as { preferences?: Prefs }).preferences ?? null));
  }, [organizationId]);

  if (!prefs) return null;

  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void fetch(`/api/businesses/${organizationId}/notification-preferences`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        }).then((res) => setMessage(res.ok ? t("saved") : t("error")));
      }}
    >
      {KEYS.map((key) => (
        <fieldset key={key} className="rounded-md border border-navy/10 bg-white px-4 py-3">
          <legend className="px-1 text-sm font-semibold text-navy">{key}</legend>
          {(["inApp", "email", "sms"] as const).map((channel) => (
            <label key={channel} className="mr-4 text-sm text-navy">
              <input
                type="checkbox"
                checked={prefs.categories[key][channel]}
                onChange={(event) =>
                  setPrefs({
                    ...prefs,
                    categories: {
                      ...prefs.categories,
                      [key]: { ...prefs.categories[key], [channel]: event.target.checked },
                    },
                  })
                }
              />{" "}
              {t(channel)}
            </label>
          ))}
        </fieldset>
      ))}
      <label className="text-sm">{t("quiet")}
        <span className="mt-1 flex gap-2">
          <input value={prefs.quietEnd} onChange={(event) => setPrefs({ ...prefs, quietEnd: event.target.value })} className="rounded-md border border-navy/15 px-2 py-1" />
          <input value={prefs.quietStart} onChange={(event) => setPrefs({ ...prefs, quietStart: event.target.value })} className="rounded-md border border-navy/15 px-2 py-1" />
        </span>
      </label>
      <label className="text-sm">{t("language")}
        <select value={prefs.language} onChange={(event) => setPrefs({ ...prefs, language: event.target.value as "en" | "fr" })} className="mt-1 block rounded-md border border-navy/15 px-2 py-1">
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </label>
      <label className="text-sm"><input type="checkbox" checked={prefs.dailySummary} onChange={(event) => setPrefs({ ...prefs, dailySummary: event.target.checked })} /> {t("summary")}</label>
      <label className="text-sm">{t("scope")}
        <select value={prefs.scope} onChange={(event) => setPrefs({ ...prefs, scope: event.target.value as Prefs["scope"] })} className="mt-1 block rounded-md border border-navy/15 px-2 py-1">
          <option value="all">{t("allEvents")}</option>
          <option value="assigned">{t("assigned")}</option>
        </select>
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">{t("save")}</button>
      {message ? <p className="text-sm">{message}</p> : null}
    </form>
  );
}
