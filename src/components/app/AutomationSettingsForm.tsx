"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AutomationConfig, AutomationRecord } from "@/product/sms-automation/types";
import { StatusHelp, StatusPill, stateOf, type StatusInputs } from "./AutomationStatus";
import { formatDuration, formatHour, type Translate } from "./automation-copy";
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

const INPUT = "mt-1 w-full min-w-0 rounded-md border border-navy/20 px-3 py-2 text-sm text-navy";
const HELP = "mt-1 text-xs text-navy/60";

export function AutomationSettingsForm({
  organizationId,
  automation,
  status,
}: {
  organizationId: string;
  automation: AutomationRecord;
  /** What the status is worked out from: the queue, whether the business can text, and the clock. */
  status: StatusInputs;
}) {
  const t = useTranslations("app.automations");
  const locale = useLocale();
  const translate = t as unknown as Translate;
  const failureText = useFailureText();
  const ids = useId();
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
  const state = stateOf(stored, status);

  /** The draft as numbers, or the first box that is not a whole number. */
  function readNumbers(): { ok: true; values: Partial<AutomationConfig> } | { ok: false } {
    const values: Partial<AutomationConfig> = {};
    for (const field of NUMBER_FIELDS) {
      if (field === "secondDelayMinutes" && !isQuote) continue;
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

  /** "That is 1 day." under a box of minutes, as long as the box holds a whole number. */
  function minutesHint(field: NumberField): string | null {
    const raw = text[field].trim();
    if (!/^\d+$/.test(raw)) return null;
    const minutes = Number(raw);
    return minutes === 0 ? t("fields.hintNow") : t("fields.hint", { duration: formatDuration(minutes, translate) });
  }

  /** "That is 8 a.m." under a box of hours, as long as it holds an hour from 0 to 24. */
  function hourHint(field: NumberField): string | null {
    const raw = text[field].trim();
    if (!/^\d+$/.test(raw) || Number(raw) > 24) return null;
    return t("fields.hourHint", { time: formatHour(Number(raw), locale, translate) });
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
        setNotice({ kind: "ok", text: t("saved") });
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

  const delayLabel = isQuote ? t("fields.delayQuote") : t("fields.delayMissed");
  const delayHelp = isQuote ? t("fields.delayQuoteHelp") : t("fields.delayMissedHelp");

  return (
    <form
      onSubmit={(event) => void save(event)}
      aria-busy={busy}
      className="flex flex-col gap-5 rounded-md border border-navy/10 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-navy">{t("status.label")}</span>
            <StatusPill state={state} testId="automation-status" />
          </div>
          {state ? <StatusHelp state={state} testId="automation-status-help" /> : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void setEnabled(!stored.enabled)}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {flight.isPending("toggle")
            ? stored.enabled
              ? t("actions.pausing")
              : t("actions.enabling")
            : stored.enabled
              ? t("actions.pause")
              : t("actions.enable")}
        </button>
      </div>

      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-1 p-0 font-semibold text-navy">{t("settings.scheduling")}</legend>
        <p className="-mt-2 text-sm text-navy/70">{t("settings.schedulingHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${ids}-delay`} label={delayLabel} help={[delayHelp, minutesHint("initialDelayMinutes")]}>
            <input
              id={`${ids}-delay`}
              type="text"
              inputMode="numeric"
              name="initialDelayMinutes"
              value={text.initialDelayMinutes}
              onChange={(event) => setNumber("initialDelayMinutes", event.target.value)}
              aria-describedby={`${ids}-delay-help`}
              className={INPUT}
            />
          </Field>
          {isQuote ? (
            <Field
              id={`${ids}-second`}
              label={t("fields.secondDelay")}
              help={[t("fields.secondDelayHelp"), minutesHint("secondDelayMinutes")]}
            >
              <input
                id={`${ids}-second`}
                type="text"
                inputMode="numeric"
                name="secondDelayMinutes"
                value={text.secondDelayMinutes}
                onChange={(event) => setNumber("secondDelayMinutes", event.target.value)}
                aria-describedby={`${ids}-second-help`}
                className={INPUT}
              />
            </Field>
          ) : null}
          {isQuote ? (
            <Field id={`${ids}-reminders`} label={t("fields.reminders")} help={[t("fields.remindersHelp")]}>
              <input
                id={`${ids}-reminders`}
                type="text"
                inputMode="numeric"
                name="maxAttempts"
                value={text.maxAttempts}
                onChange={(event) => setNumber("maxAttempts", event.target.value)}
                aria-describedby={`${ids}-reminders-help`}
                className={INPUT}
              />
            </Field>
          ) : null}
          {windowApplies ? (
            <>
              <Field id={`${ids}-start`} label={t("fields.windowStart")} help={[hourHint("windowStartHour")]}>
                <input
                  id={`${ids}-start`}
                  type="text"
                  inputMode="numeric"
                  name="windowStartHour"
                  value={text.windowStartHour}
                  onChange={(event) => setNumber("windowStartHour", event.target.value)}
                  aria-describedby={`${ids}-start-help`}
                  className={INPUT}
                />
              </Field>
              <Field id={`${ids}-end`} label={t("fields.windowEnd")} help={[hourHint("windowEndHour")]}>
                <input
                  id={`${ids}-end`}
                  type="text"
                  inputMode="numeric"
                  name="windowEndHour"
                  value={text.windowEndHour}
                  onChange={(event) => setNumber("windowEndHour", event.target.value)}
                  aria-describedby={`${ids}-end-help`}
                  className={INPUT}
                />
              </Field>
            </>
          ) : null}
        </div>
        <div className="grid gap-3 text-sm text-navy">
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
            <Check
              label={t("fields.weekend")}
              checked={draft.weekendSending}
              onChange={(value) => setFlag("weekendSending", value)}
            />
          ) : null}
        </div>
      </fieldset>

      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-1 p-0 font-semibold text-navy">{t("settings.rulesTitle")}</legend>
        <div className="sm:max-w-sm">
          <Field id={`${ids}-language`} label={t("fields.language")} help={[t("fields.languageHelp")]}>
            <select
              id={`${ids}-language`}
              value={draft.language}
              onChange={(event) => {
                setNotice(null);
                setDraft((current) => ({
                  ...current,
                  language: event.target.value as AutomationConfig["language"],
                }));
              }}
              aria-describedby={`${ids}-language-help`}
              className={INPUT}
            >
              <option value="customer">{t("fields.languageCustomer")}</option>
              <option value="en">{t("fields.languageEn")}</option>
              <option value="fr">{t("fields.languageFr")}</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-3 text-sm text-navy">
          {isMissedCall ? (
            <Check
              label={t("fields.duplicate")}
              checked={draft.duplicateProtection}
              onChange={(value) => setFlag("duplicateProtection", value)}
            />
          ) : null}
          <Check
            label={t("fields.stopReply")}
            checked={draft.stopOnCustomerReply}
            onChange={(value) => setFlag("stopOnCustomerReply", value)}
          />
          <Check
            label={t("fields.stopHuman")}
            checked={draft.stopOnHumanContact}
            onChange={(value) => setFlag("stopOnHumanContact", value)}
          />
          {isQuote ? <p className="text-xs text-navy/60">{t("settings.quoteAlwaysStops")}</p> : null}
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
          {flight.isPending("save") ? t("actions.saving") : t("actions.save")}
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

/** A labelled box. The label holds only the label; the help sits beside it, linked by aria-describedby. */
function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: (string | null)[];
  children: React.ReactNode;
}) {
  const lines = help.filter(Boolean).join(" ");
  return (
    <div className="min-w-0 text-sm text-navy">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {children}
      <p id={`${id}-help`} className={HELP}>
        {lines}
      </p>
    </div>
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
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}
