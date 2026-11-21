"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, requestJson } from "@/lib/client/request";
import type { TemplateKey, TemplateRecord } from "@/product/sms-automation/types";
import { TEMPLATE_VARIABLES } from "@/product/sms-automation/types";
import { BusyLabel } from "@/components/ui/Spinner";
import { describeFailure, useFailureText, useKeyedSingleFlight } from "./automation-client";

import { useGuarded } from "@/lib/client/use-single-flight";
type Preview = {
  body: string;
  errors: string[];
  segments: number;
  encoding: string;
  chars: number;
  missing: string[];
};

const draftKey = (key: TemplateKey, locale: "en" | "fr") => `${key}:${locale}`;

export function TemplateManager({
  organizationId,
  templates,
  labels,
}: {
  organizationId: string;
  templates: TemplateRecord[];
  labels: {
    language: string;
    variables: string;
    preview: string;
    save: string;
    reset: string;
    chars: string;
    segments: string;
    segmentWarning: string;
    saved: string;
    error: string;
    missing: string;
    /** Why a template was refused, by validation code. */
    errors: Record<string, string>;
    names: Record<TemplateKey, string>;
  };
}) {
  const t = useTranslations("app.automations");
  const tFeedback = useTranslations("feedback");
  const failureText = useFailureText();
  // The saved templates as the server last confirmed them. A save replaces its row here,
  // so going to another template and back shows what was saved, not the page's first load.
  const [rows, setRows] = useState(templates);
  const [key, setKey] = useState<TemplateKey>(templates[0]?.templateKey ?? "missed_call_recovery");
  const [locale, setLocale] = useState<"en" | "fr">("fr");
  // Text typed but not saved yet, per template, so switching templates loses nothing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flight = useKeyedSingleFlight();
  const busy = flight.anyPending;

  const current = rows.find((row) => row.templateKey === key && row.locale === locale) ?? rows[0];
  const body = drafts[draftKey(key, locale)] ?? current?.body ?? "";
  const unsaved = current !== undefined && body !== current.body;

  const keys = useMemo(
    () => [...new Set(rows.map((row) => row.templateKey))],
    [rows],
  );

  /** The validator answers with short codes; the owner reads sentences. */
  function reasons(codes: string[]): string {
    const lines = codes.map((code) => labels.errors[code.trim()]).filter(Boolean);
    return lines.length > 0 ? [...new Set(lines)].join(" ") : labels.error;
  }
  function describeError(err: unknown): string {
    if (err instanceof ApiError && err.kind === "client") {
      const detail = (err.body as { error?: unknown } | undefined)?.error;
      const rejected = /^Template rejected:\s*(.+)$/.exec(typeof detail === "string" ? detail : "");
      if (rejected) return reasons(rejected[1].split(","));
    }
    return failureText(describeFailure(err));
  }

  function choose(nextKey: TemplateKey, nextLocale: "en" | "fr") {
    setKey(nextKey);
    setLocale(nextLocale);
    setPreview(null);
    setMessage(null);
    setError(null);
  }

  function edit(next: string) {
    setMessage(null);
    setDrafts((all) => ({ ...all, [draftKey(key, locale)]: next }));
  }

  function insertVariable(name: string) {
    edit(`${body}{{${name}}}`);
  }

  const runPreview = useGuarded(runPreviewHandler);
  async function runPreviewHandler() {
    await flight.run("preview", async () => {
      setError(null);
      try {
        const data = await requestJson<{ preview?: Preview }>(
          `/api/businesses/${organizationId}/automation-templates`,
          { method: "POST", body: { action: "preview", templateKey: key, locale, body } },
        );
        if (!data?.preview) throw new ApiError("invalid_response", 200, "No preview.");
        setPreview(data.preview);
      } catch (err) {
        setError(describeError(err));
      }
    });
  }

  const save = useGuarded(saveHandler);
  async function saveHandler(reset = false) {
    if (!current) return;
    await flight.run(reset ? "reset" : "save", async () => {
      setError(null);
      setMessage(null);
      const sent = draftKey(current.templateKey, current.locale);
      try {
        const data = await requestJson<{ template?: TemplateRecord }>(
          `/api/businesses/${organizationId}/automation-templates/${current.id}`,
          { method: "PUT", body: reset ? { reset: true } : { body } },
        );
        const saved = data?.template;
        if (!saved) throw new ApiError("invalid_response", 200, "No template.");
        setRows((all) => all.map((row) => (row.id === saved.id ? saved : row)));
        setDrafts((all) => {
          const next = { ...all };
          delete next[sent];
          return next;
        });
        setPreview(null);
        setMessage(labels.saved);
      } catch (err) {
        // The text stays on screen, marked unsaved: nothing was confirmed.
        setError(describeError(err));
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <ul className="rounded-md border border-navy/10 bg-white">
        {keys.map((templateKey) => (
          <li key={templateKey}>
            <button
              type="button"
              onClick={() => choose(templateKey, locale)}
              className={`w-full px-3 py-2 text-left text-sm ${
                templateKey === key ? "bg-navy/10 font-semibold text-navy" : "text-navy/80"
              }`}
            >
              {labels.names[templateKey]}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
        <label className="text-xs text-navy/70">
          {labels.language}
          <select
            value={locale}
            onChange={(event) => choose(key, event.target.value === "en" ? "en" : "fr")}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-navy/60">{labels.variables}</span>
          {TEMPLATE_VARIABLES.map((name) => (
            <button
              key={name}
              type="button"
              disabled={busy}
              onClick={() => insertVariable(name)}
              className="rounded-md border border-navy/15 px-2 py-1 text-xs text-navy"
            >
              {t(`templateUi.variableNames.${name}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-navy/60">
          {t("templateUi.variablesHint", { example: "{{business_name}}" })}
        </p>
        <textarea
          value={body}
          disabled={busy}
          onChange={(event) => edit(event.target.value)}
          rows={8}
          className="w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
        />
        <p className="text-xs text-navy/60">
          {labels.chars}: {body.length}
          {unsaved ? (
            <span data-testid="template-unsaved" className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
              {t("unsaved")}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} aria-busy={flight.isPending("preview")} onClick={() => void runPreview()} className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy disabled:opacity-60">
            <BusyLabel pending={flight.isPending("preview")} busyLabel={tFeedback("working")}>{labels.preview}</BusyLabel>
          </button>
          <button type="button" disabled={busy} aria-busy={flight.isPending("save")} onClick={() => void save(false)} className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            <BusyLabel pending={flight.isPending("save")} busyLabel={t("actions.saving")}>{labels.save}</BusyLabel>
          </button>
          <button type="button" disabled={busy} aria-busy={flight.isPending("reset")} onClick={() => void save(true)} className="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy disabled:opacity-60">
            <BusyLabel pending={flight.isPending("reset")} busyLabel={t("actions.saving")}>{labels.reset}</BusyLabel>
          </button>
        </div>
        {preview ? (
          <div className="rounded-md bg-[var(--color-surface,#f7f5f1)] p-3 text-sm text-navy">
            <p>{preview.body}</p>
            <p className="mt-2 text-xs text-navy/60">
              {labels.chars}: {preview.chars} · {labels.segments}: {preview.segments}
            </p>
            {preview.segments > 1 ? (
              <p className="mt-1 text-xs text-navy">{labels.segmentWarning}</p>
            ) : null}
            {preview.encoding === "ucs2" ? (
              <p className="mt-1 text-xs text-navy/60">{t("templateUi.shorterParts")}</p>
            ) : null}
            {preview.missing.length > 0 ? (
              <p className="mt-1 text-xs text-red-800">
                {labels.missing}:{" "}
                {preview.missing
                  .map((name) => (t.has(`templateUi.variableNames.${name}`) ? t(`templateUi.variableNames.${name}`) : name))
                  .join(", ")}
              </p>
            ) : null}
            {preview.errors.length > 0 ? (
              <p className="mt-1 text-xs text-red-800">{reasons(preview.errors)}</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
        {message ? <p role="status" className="text-sm text-navy">{message}</p> : null}
      </div>
    </div>
  );
}
