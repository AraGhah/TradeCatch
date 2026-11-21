"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { DEFAULT_CHANNELS } from "@/product/notifications/templates";
import type { PreferenceCategory } from "@/product/notifications/types";
import {
  notificationTimezone,
  quietHours,
} from "@/product/notifications/preferences";

import { RequestTimeoutError, timedFetch } from "@/lib/client/timed-fetch";
import { useGuarded } from "@/lib/client/use-single-flight";
import { LoadingRegion, SkeletonRows } from "@/components/ui/Skeleton";
import { BusyLabel } from "@/components/ui/Spinner";

const KEYS = Object.keys(DEFAULT_CHANNELS) as PreferenceCategory[];

type Prefs = {
  categories: Record<
    PreferenceCategory,
    { inApp: boolean; email: boolean; sms: boolean }
  >;
  quietStart: string;
  quietEnd: string;
  quietEnabled: boolean;
  language: "en" | "fr";
  timezone?: string;
  dailySummary: boolean;
  scope: "all" | "assigned";
};

const preferencesSchema = z.object({
  categories: z.record(
    z.enum(KEYS as [PreferenceCategory, ...PreferenceCategory[]]),
    z.object({ inApp: z.boolean(), email: z.boolean(), sms: z.boolean() }),
  ),
  quietStart: z.string(),
  quietEnd: z.string(),
  quietEnabled: z.boolean(),
  language: z.enum(["en", "fr"]),
  timezone: z.string().optional(),
  dailySummary: z.boolean(),
  scope: z.enum(["all", "assigned"]),
});

export function NotificationPreferencesForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.alerts");
  const tFeedback = useTranslations("feedback");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const setMessage = (text: string | null, error = true) =>
    setNotice(text ? { text, error } : null);
  const [load, setLoad] = useState({ organizationId, status: "loading" });
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);

  // Declared before the early returns below: hooks run on every render. Guarded
  // so fifty fast clicks (or Enter held down) send one request, not fifty.
  const submit = useGuarded(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!prefs) return;
    if (!quietHours.safeParse(prefs).success) {
      setMessage(t("invalidQuietHours"));
      return;
    }
    if (!notificationTimezone.safeParse(prefs.timezone).success) {
      setMessage(t("invalidTimezone"));
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/notification-preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        },
      );
      // "Saved" only once the server said so.
      if (res.ok) setMessage(t("saved"), false);
      else setMessage(t("error"));
    } catch (cause) {
      // No answer: it may have been saved. The choices stay on screen.
      setMessage(
        tFeedback(
          cause instanceof RequestTimeoutError
            ? "errors.timeoutUnknown"
            : "errors.networkUnknown",
        ),
      );
    } finally {
      setSaving(false);
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    void timedFetch(`/api/businesses/${organizationId}/notification-preferences`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Preferences unavailable");
        const data = await res.json();
        const { preferences } = z
          .object({ preferences: preferencesSchema })
          .parse(data);
        if (!controller.signal.aborted) {
          setPrefs(preferences);
          setLoad({ organizationId, status: "ready" });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoad({ organizationId, status: "error" });
      });
    return () => controller.abort();
  }, [organizationId, retry]);

  if (load.organizationId !== organizationId || load.status === "loading")
    return (
      <LoadingRegion label={t("preferencesLoading")}>
        <SkeletonRows rows={6} columns={2} />
      </LoadingRegion>
    );
  if (load.status === "error" || !prefs)
    return (
      <div role="alert">
        <p>{t("preferencesLoadError")}</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ organizationId, status: "loading" });
            setRetry((value) => value + 1);
          }}
        >
          {t("retry")}
        </button>
      </div>
    );

  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      aria-busy={saving}
      onSubmit={(event) => void submit(event)}
    >
      {KEYS.map((key) => (
        <fieldset
          key={key}
          className="rounded-md border border-navy/10 bg-white px-4 py-3"
        >
          <legend className="px-1 text-sm font-semibold text-navy">
            {t(`categories.${key}`)}
          </legend>
          {key === "replies" ? (
            <p className="mb-2 text-sm text-navy/70">{t("gmailRepliesHint")}</p>
          ) : null}
          {key === "outages" ? (
            <p className="mb-2 text-sm text-navy/70">{t("outagesHint")}</p>
          ) : null}
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
                      [key]: {
                        ...prefs.categories[key],
                        [channel]: event.target.checked,
                      },
                    },
                  })
                }
              />{" "}
              {t(channel)}
            </label>
          ))}
        </fieldset>
      ))}
      <label className="text-sm">
        <input
          type="checkbox"
          role="switch"
          aria-checked={prefs.quietEnabled}
          checked={prefs.quietEnabled}
          onChange={(event) =>
            setPrefs({ ...prefs, quietEnabled: event.target.checked })
          }
        />{" "}
        {t("quiet")}
      </label>
      {/* Start first, then end, each with its own visible label. */}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span aria-hidden="true">{t("quietFrom")}</span>
          <input
            type="time"
            required
            aria-label={t("quietStart")}
            value={prefs.quietStart}
            onChange={(event) =>
              setPrefs({ ...prefs, quietStart: event.target.value })
            }
            className="rounded-md border border-navy/15 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span aria-hidden="true">{t("quietTo")}</span>
          <input
            type="time"
            required
            aria-label={t("quietEnd")}
            value={prefs.quietEnd}
            onChange={(event) =>
              setPrefs({ ...prefs, quietEnd: event.target.value })
            }
            className="rounded-md border border-navy/15 px-2 py-1"
          />
        </label>
      </div>
      <p className="m-0 text-xs text-navy/70">{t("quietHint")}</p>
      <label className="text-sm">
        {t("personalTimezone")}
        <input
          type="text"
          list="notification-timezones"
          value={prefs.timezone || ""}
          placeholder={t("businessTimezone")}
          onChange={(event) =>
            setPrefs({ ...prefs, timezone: event.target.value })
          }
          className="mt-1 block rounded-md border border-navy/15 px-2 py-1"
        />
        <datalist id="notification-timezones">
          {[
            "America/St_Johns",
            "America/Halifax",
            "America/Toronto",
            "America/Winnipeg",
            "America/Regina",
            "America/Edmonton",
            "America/Vancouver",
            "UTC",
            "Europe/Paris",
          ].map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <span className="mt-1 block text-xs text-navy/70">
          {t("timezoneHint")}
        </span>
      </label>
      <label className="text-sm">
        {t("language")}
        <select
          value={prefs.language}
          onChange={(event) =>
            setPrefs({ ...prefs, language: event.target.value as "en" | "fr" })
          }
          className="mt-1 block rounded-md border border-navy/15 px-2 py-1"
        >
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </label>
      <label className="text-sm">
        <input
          type="checkbox"
          checked={prefs.dailySummary}
          onChange={(event) =>
            setPrefs({ ...prefs, dailySummary: event.target.checked })
          }
        />{" "}
        {t("summary")}
      </label>
      <label className="text-sm">
        {t("scope")}
        <select
          value={prefs.scope}
          onChange={(event) =>
            setPrefs({ ...prefs, scope: event.target.value as Prefs["scope"] })
          }
          className="mt-1 block rounded-md border border-navy/15 px-2 py-1"
        >
          <option value="all">{t("allEvents")}</option>
          <option value="assigned">{t("assigned")}</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={saving}
        aria-busy={saving}
        className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
      >
        <BusyLabel pending={saving} busyLabel={tFeedback("saving")}>
          {t("save")}
        </BusyLabel>
      </button>
      {/* A live region either way: the result is announced, and it was already one. */}
      {notice ? (
        <p role="status" data-tone={notice.error ? "error" : "success"} className="text-sm">
          {notice.text}
        </p>
      ) : null}
    </form>
  );
}
