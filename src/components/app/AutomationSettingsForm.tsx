"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AutomationConfig, AutomationRecord } from "@/product/sms-automation/types";
import {
  describeFailure,
  readStored,
  requestEnabled,
  requestSettings,
  useFailureText,
  useKeyedSingleFlight,
} from "./automation-client";

type NumberField =
  | "initialDelayMinutes"
  | "secondDelayMinutes"
  | "maxAttempts"
  | "windowStartHour"
  | "windowEndHour";

type BooleanField =
  | "weekendSending"
  | "duplicateProtection"
  | "stopOnCustomerReply"
  | "stopOnHumanContact"
  | "respectQuietHours";

const NUMBER_FIELDS: NumberField[] = [
  "initialDelayMinutes",
  "secondDelayMinutes",
  "maxAttempts",
  "windowStartHour",
  "windowEndHour",
];
const BOOLEAN_FIELDS: BooleanField[] = [
  "weekendSending",
  "duplicateProtection",
  "stopOnCustomerReply",
  "stopOnHumanContact",
  "respectQuietHours",
];

type Notice = { kind: "ok" | "error"; text: string } | null;

/** Number boxes hold text while typing, so a box can be emptied and retyped. */
function toText(config: AutomationConfig): Record<NumberField, string> {
  return {
    initialDelayMinutes: String(config.initialDelayMinutes ?? 0),
    secondDelayMinutes: String(config.secondDelayMinutes ?? 0),
    maxAttempts: String(config.maxAttempts ?? 1),
    windowStartHour: String(config.windowStartHour ?? 8),
    windowEndHour: String(config.windowEndHour ?? 20),
  };
}

export function AutomationSettingsForm({
  organizationId,
  automation,
  labels,
  showSecondDelay,
}: {
  organizationId: string;
  automation: AutomationRecord;
  showSecondDelay?: boolean;
  labels: {
    save: string;
    saved: string;
    error: string;
    status: string;
    active: string;
    inactive: string;
    enable: string;
    disable: string;
    delay: string;
    secondDelay: string;
    language: string;
    languageCustomer: string;
    languageEn: string;
    languageFr: string;
    attempts: string;
    windowStart: string;
    windowEnd: string;
    weekend: string;
    duplicate: string;
    stopReply: string;
    stopHuman: string;
    stopAccepted: string;
    stopRejected: string;
    minutes: string;
  };
}) {
  const t = useTranslations("app.automations");
  const failureText = useFailureText();
  const isMissedCall = automation.type === "missed_call_recovery";
  const isQuote = automation.type === "quote_followup";

  // `stored` is what the server last confirmed. `draft` is what is on screen.
  const [stored, setStored] = useState(automation);
  const [draft, setDraft] = useState<AutomationConfig>(automation.config);
  const [text, setText] = useState(() => toText(automation.config));
  const [notice, setNotice] = useState<Notice>(null);
  const flight = useKeyedSingleFlight();
  const busy = flight.anyPending;

  // A missed-call text answers the caller's own call and goes out at once. The sending
  // window only applies to it when the owner asks for quiet hours.
  const windowApplies = !isMissedCall || draft.respectQuietHours === true;

  /** The draft as numbers, or the first box that is not a whole number. */
  function readNumbers(): { ok: true; values: Partial<AutomationConfig> } | { ok: false } {
    const values: Partial<AutomationConfig> = {};
    for (const field of NUMBER_FIELDS) {
      if (field === "secondDelayMinutes" && !showSecondDelay) continue;
      if ((field === "windowStartHour" || field === "windowEndHour") && !windowApplies) continue;
      const raw = text[field].trim();
      if (!/^\d+$/.test(raw)) return { ok: false };
      Object.assign(values, { [field]: Number(raw) });
    }
    return { ok: true, values };
  }

  /** Only what differs from the stored settings is sent, so a save cannot overwrite a field it did not touch. */
  function changes(): { patch: Partial<AutomationConfig>; invalid: boolean } {
    const numbers = readNumbers();
    if (!numbers.ok) return { patch: {}, invalid: true };
    const next: Partial<AutomationConfig> = { ...numbers.values, language: draft.language };
    for (const field of BOOLEAN_FIELDS) {
      if (field === "weekendSending" && !windowApplies) continue;
      if (field === "respectQuietHours" && !isMissedCall) continue;
      next[field] = draft[field] === true;
    }
    const patch: Partial<AutomationConfig> = {};
    for (const [key, value] of Object.entries(next)) {
      const before = stored.config[key as keyof AutomationConfig];
      const same = key === "respectQuietHours" ? (before === true) === (value === true) : before === value;
      if (!same) Object.assign(patch, { [key]: value });
    }
    return { patch, invalid: false };
  }

  const { patch: pending, invalid } = changes();
  const unsaved = invalid || Object.keys(pending).length > 0;

  function setNumber(field: NumberField, value: string) {
    setNotice(null);
    setText((current) => ({ ...current, [field]: value }));
  }

  function setFlag(field: BooleanField, value: boolean) {
    setNotice(null);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await flight.run("save", async () => {
      const { patch, invalid: bad } = changes();
      if (bad) {
        setNotice({ kind: "error", text: t("invalid.number") });
        return;
      }
      if (Object.keys(patch).length === 0) {
        setNotice({ kind: "ok", text: t("unchanged") });
        return;
      }
      setNotice(null);
      try {
        const saved = await requestSettings(organizationId, stored.id, patch);
        setStored(saved);
        setDraft(saved.config);
        setText(toText(saved.config));
        setNotice({ kind: "ok", text: labels.saved });
      } catch (err) {
        // Keep what was typed (it stays marked unsaved) and learn what is really stored.
        const current = await readStored(organizationId, stored.id);
        if (current) setStored(current);
        setNotice({ kind: "error", text: failureText(describeFailure(err)) });
      }
    });
  }

  async function setEnabled(enabled: boolean) {
    await flight.run("toggle", async () => {
      setNotice(null);
      try {
        const { automation: updated, canceled } = await requestEnabled(organizationId, stored.id, enabled);
        // Only the switch: the form's own unsaved settings are not touched.
        setStored((current) => ({ ...current, enabled: updated.enabled, updatedAt: updated.updatedAt }));
        setNotice({
          kind: "ok",
          text: enabled ? t("toggle.enabled") : t("toggle.disabled", { count: canceled }),
        });
      } catch (err) {
        const current = await readStored(organizationId, stored.id);
        if (current) setStored((previous) => ({ ...previous, enabled: current.enabled }));
        setNotice({ kind: "error", text: failureText(describeFailure(err)) });
      }
    });
  }

  const input = "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy";

  return (
    <form
      onSubmit={(event) => void save(event)}
      aria-busy={busy}
      className="flex flex-col gap-4 rounded-md border border-navy/10 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-navy" data-testid="automation-status">
          {labels.status}: {stored.enabled ? labels.active : labels.inactive}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void setEnabled(!stored.enabled)}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {flight.isPending("toggle")
            ? stored.enabled
              ? t("toggle.disabling")
              : t("toggle.enabling")
            : stored.enabled
              ? labels.disable
              : labels.enable}
        </button>
      </div>
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {labels.delay} ({labels.minutes})
            <input
              type="text"
              inputMode="numeric"
              name="initialDelayMinutes"
              value={text.initialDelayMinutes}
              onChange={(event) => setNumber("initialDelayMinutes", event.target.value)}
              className={input}
            />
          </label>
          {showSecondDelay ? (
            <label className="text-xs text-navy/70">
              {labels.secondDelay} ({labels.minutes})
              <input
                type="text"
                inputMode="numeric"
                name="secondDelayMinutes"
                value={text.secondDelayMinutes}
                onChange={(event) => setNumber("secondDelayMinutes", event.target.value)}
                className={input}
              />
            </label>
          ) : null}
          <label className="text-xs text-navy/70">
            {labels.language}
            <select
              value={draft.language}
              onChange={(event) => {
                setNotice(null);
                setDraft((current) => ({
                  ...current,
                  language: event.target.value as AutomationConfig["language"],
                }));
              }}
              className={input}
            >
              <option value="customer">{labels.languageCustomer}</option>
              <option value="en">{labels.languageEn}</option>
              <option value="fr">{labels.languageFr}</option>
            </select>
          </label>
          <label className="text-xs text-navy/70">
            {labels.attempts}
            <input
              type="text"
              inputMode="numeric"
              name="maxAttempts"
              value={text.maxAttempts}
              onChange={(event) => setNumber("maxAttempts", event.target.value)}
              className={input}
            />
          </label>
          {windowApplies ? (
            <>
              <label className="text-xs text-navy/70">
                {labels.windowStart}
                <input
                  type="text"
                  inputMode="numeric"
                  name="windowStartHour"
                  value={text.windowStartHour}
                  onChange={(event) => setNumber("windowStartHour", event.target.value)}
                  className={input}
                />
              </label>
              <label className="text-xs text-navy/70">
                {labels.windowEnd}
                <input
                  type="text"
                  inputMode="numeric"
                  name="windowEndHour"
                  value={text.windowEndHour}
                  onChange={(event) => setNumber("windowEndHour", event.target.value)}
                  className={input}
                />
              </label>
            </>
          ) : null}
        </div>
        <div className="grid gap-2 text-sm text-navy">
          {isMissedCall ? (
            <div>
              <Check
                label={t("quietHours.label")}
                checked={draft.respectQuietHours === true}
                onChange={(value) => setFlag("respectQuietHours", value)}
              />
              <p className="mt-1 pl-6 text-xs text-navy/60">{t("quietHours.help")}</p>
            </div>
          ) : null}
          {windowApplies ? (
            <Check label={labels.weekend} checked={draft.weekendSending} onChange={(value) => setFlag("weekendSending", value)} />
          ) : null}
          <Check label={labels.duplicate} checked={draft.duplicateProtection} onChange={(value) => setFlag("duplicateProtection", value)} />
          <Check label={labels.stopReply} checked={draft.stopOnCustomerReply} onChange={(value) => setFlag("stopOnCustomerReply", value)} />
          <Check label={labels.stopHuman} checked={draft.stopOnHumanContact} onChange={(value) => setFlag("stopOnHumanContact", value)} />
          {isQuote ? <p className="text-xs text-navy/60">{t("quoteAlwaysStops")}</p> : null}
        </div>
      </fieldset>
      <div aria-live="polite" className="min-h-5">
        {notice ? (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={`text-sm ${notice.kind === "error" ? "text-red-800" : "text-green-800"}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          aria-busy={flight.isPending("save")}
          className="w-fit rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy disabled:opacity-60"
        >
          {flight.isPending("save") ? t("saving") : labels.save}
        </button>
        {unsaved && !busy ? (
          <span data-testid="unsaved" className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
            {t("unsaved")}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
