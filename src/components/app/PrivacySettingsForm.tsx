"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { setBusinessAnalytics } from "@/lib/analytics";

const settingsSchema = z.object({
  callRecordingEnabled: z.boolean(),
  saveCallTranscripts: z.boolean(),
  saveSmsHistory: z.boolean(),
  customerDataRetentionDays: z.union([
    z.literal(30),
    z.literal(90),
    z.literal(180),
    z.null(),
  ]),
  analyticsEnabled: z.boolean(),
  version: z.number().int().min(0),
});
type Settings = z.infer<typeof settingsSchema>;
type Values = Omit<Settings, "version">;
type Field = keyof Values;

const FIELDS: Field[] = [
  "callRecordingEnabled",
  "saveCallTranscripts",
  "saveSmsHistory",
  "customerDataRetentionDays",
  "analyticsEnabled",
];

const responseSchema = z.object({ settings: settingsSchema });

function changedFields(draft: Values, confirmed: Values): Field[] {
  return FIELDS.filter((field) => draft[field] !== confirmed[field]);
}

type Notice =
  | { kind: "saved" }
  | { kind: "unchanged" }
  | { kind: "error" }
  | { kind: "stale" }
  | { kind: "denied" }
  | null;

/**
 * The business's privacy settings. What is shown is always what the server
 * stored: values load from the API, a save reports success only after the API
 * confirms it, and a failed save leaves the unsaved values marked as such.
 */
export function PrivacySettingsForm({
  organizationId,
  canEdit,
  analyticsAvailable,
}: {
  organizationId: string;
  canEdit: boolean;
  /** Usage analytics are configured for this site; otherwise the setting would do nothing. */
  analyticsAvailable: boolean;
}) {
  const t = useTranslations("app.privacy");
  const [confirmed, setConfirmed] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Values | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const savingRef = useRef(false);
  const url = `/api/businesses/${organizationId}/privacy`;

  /** The stored settings, or null when they could not be loaded. */
  const fetchSettings = useCallback(async (): Promise<Settings | null> => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return null;
      return responseSchema.parse(await response.json()).settings;
    } catch {
      return null;
    }
  }, [url]);

  const show = useCallback((settings: Settings | null) => {
    if (!settings) {
      setLoadFailed(true);
      return;
    }
    setConfirmed(settings);
    setDraft(settings);
  }, []);

  useEffect(() => {
    let live = true;
    void fetchSettings().then((settings) => {
      if (live) show(settings);
    });
    return () => {
      live = false;
    };
  }, [fetchSettings, show]);

  async function retry() {
    setLoadFailed(false);
    show(await fetchSettings());
  }

  async function save() {
    if (!confirmed || !draft || savingRef.current || !canEdit) return;
    const fields = changedFields(draft, confirmed);
    if (fields.length === 0) {
      setNotice({ kind: "unchanged" });
      return;
    }
    const sent: Partial<Values> = {};
    for (const field of fields) Object.assign(sent, { [field]: draft[field] });
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: confirmed.version, ...sent }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 409) {
        // Someone else saved first: show what is stored now, nothing of ours.
        const { settings } = responseSchema.parse(body);
        setConfirmed(settings);
        setDraft(settings);
        setNotice({ kind: "stale" });
        return;
      }
      if (response.status === 403) {
        setNotice({ kind: "denied" });
        return;
      }
      if (!response.ok) throw new Error("save failed");
      const { settings } = responseSchema.parse(body);
      setConfirmed(settings);
      // Fields changed again while this save was in flight keep the newer,
      // still-unsaved choice; everything else shows the stored value.
      setDraft((current) => {
        const next = { ...settings } as Values;
        if (!current) return next;
        for (const field of FIELDS) {
          if (field in sent && current[field] !== sent[field])
            Object.assign(next, { [field]: current[field] });
        }
        return next;
      });
      setBusinessAnalytics(settings.analyticsEnabled);
      setNotice({ kind: "saved" });
    } catch {
      // Nothing confirmed: the stored values stay as they were and the
      // unsaved choices remain on screen, marked "Not saved".
      setNotice({ kind: "error" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loadFailed)
    return (
      <div role="alert" className="flex max-w-xl flex-col gap-2 rounded-md bg-white p-4 text-sm text-red-800 ring-1 ring-red-200">
        <p>{t("loadError")}</p>
        <button
          type="button"
          className="w-fit rounded-md border border-navy/20 px-3 py-1.5 text-navy"
          onClick={() => void retry()}
        >
          {t("retry")}
        </button>
      </div>
    );

  if (!confirmed || !draft)
    return (
      <p role="status" className="text-sm text-navy/70">
        {t("loading")}
      </p>
    );

  const unsaved = new Set(changedFields(draft, confirmed));
  const set = <F extends Field>(field: F, value: Values[F]) => {
    setNotice(null);
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };
  const marker = (field: Field) =>
    unsaved.has(field) ? (
      <span
        data-testid={`unsaved-${field}`}
        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900"
      >
        {t("notSaved")}
      </span>
    ) : null;

  const toggle = (
    field: "callRecordingEnabled" | "saveCallTranscripts" | "saveSmsHistory" | "analyticsEnabled",
    key: "recording" | "transcripts" | "sms" | "analytics",
    extra?: React.ReactNode,
  ) => (
    <div className="border-t border-navy/10 pt-4 first:border-t-0 first:pt-0">
      <label className="flex items-start gap-3 text-sm font-semibold text-navy">
        <input
          type="checkbox"
          name={field}
          className="mt-0.5 h-4 w-4"
          checked={draft[field]}
          onChange={(event) => set(field, event.target.checked)}
        />
        <span>
          {t(`${key}.label`)}
          {marker(field)}
        </span>
      </label>
      <p className="mt-1 pl-7 text-sm text-navy/70">{t(`${key}.help`)}</p>
      {extra}
    </div>
  );

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {!canEdit ? (
        <p className="rounded-md bg-navy/5 px-3 py-2 text-sm text-navy">{t("readOnly")}</p>
      ) : null}
      <fieldset
        disabled={!canEdit}
        className="flex flex-col gap-4 rounded-md bg-white p-4 ring-1 ring-navy/10"
      >
        <legend className="sr-only">{t("headline")}</legend>
        {toggle("callRecordingEnabled", "recording")}
        {toggle(
          "saveCallTranscripts",
          "transcripts",
          !draft.saveCallTranscripts ? (
            <p className="mt-1 pl-7 text-sm text-amber-900">{t("transcripts.offImpact")}</p>
          ) : null,
        )}
        {toggle("saveSmsHistory", "sms")}
        <div className="border-t border-navy/10 pt-4">
          <label className="block text-sm font-semibold text-navy" htmlFor="privacy-retention">
            {t("retention.label")}
            {marker("customerDataRetentionDays")}
          </label>
          <select
            id="privacy-retention"
            name="customerDataRetentionDays"
            className="mt-2 block w-full max-w-xs rounded-md border border-navy/15 px-2 py-2 text-sm text-navy"
            value={draft.customerDataRetentionDays ?? "standard"}
            onChange={(event) =>
              set(
                "customerDataRetentionDays",
                event.target.value === "standard"
                  ? null
                  : (Number(event.target.value) as 30 | 90 | 180),
              )
            }
          >
            {confirmed.customerDataRetentionDays === null ? (
              <option value="standard">{t("retention.standard")}</option>
            ) : null}
            <option value="30">{t("retention.days", { days: 30 })}</option>
            <option value="90">{t("retention.days", { days: 90 })}</option>
            <option value="180">{t("retention.days", { days: 180 })}</option>
          </select>
          <p className="mt-1 text-sm text-navy/70">{t("retention.help")}</p>
          <p className="mt-1 text-xs text-navy/60">{t("retention.excludes")}</p>
        </div>
        {analyticsAvailable ? (
          toggle("analyticsEnabled", "analytics")
        ) : (
          <div className="border-t border-navy/10 pt-4">
            <p className="text-sm font-semibold text-navy">{t("analytics.label")}</p>
            <p className="mt-1 text-sm text-navy/70">{t("analytics.notUsed")}</p>
          </div>
        )}
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
          {unsaved.size > 0 && !saving ? (
            <span className="text-sm text-navy/70">{t("unsavedCount", { count: unsaved.size })}</span>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite">
        {notice?.kind === "saved" ? (
          <p role="status" className="text-sm text-green-800">{t("saved")}</p>
        ) : notice?.kind === "unchanged" ? (
          <p role="status" className="text-sm text-navy/70">{t("unchanged")}</p>
        ) : notice ? (
          <p role="alert" className="text-sm text-red-800">
            {notice.kind === "stale"
              ? t("stale")
              : notice.kind === "denied"
                ? t("denied")
                : t("saveError")}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-3 rounded-md bg-white p-4 text-sm text-navy ring-1 ring-navy/10">
        <div>
          <h2 className="font-semibold">{t("calendar.title")}</h2>
          <p className="mt-1 text-navy/70">{t("calendar.body")}</p>
        </div>
        <div>
          <h2 className="font-semibold">{t("marketing.title")}</h2>
          <p className="mt-1 text-navy/70">{t("marketing.body")}</p>
        </div>
        <div>
          <h2 className="font-semibold">{t("data.title")}</h2>
          <p className="mt-1 text-navy/70">{t("data.body")}</p>
          <Link href="/app/settings/account" className="mt-1 inline-block font-semibold underline">
            {t("data.link")}
          </Link>
        </div>
      </section>
    </form>
  );
}
