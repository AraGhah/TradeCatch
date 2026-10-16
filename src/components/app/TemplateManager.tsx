"use client";

import { useMemo, useState } from "react";
import type { TemplateKey, TemplateRecord } from "@/product/sms-automation/types";
import { TEMPLATE_VARIABLES } from "@/product/sms-automation/types";

type Preview = {
  body: string;
  errors: string[];
  segments: number;
  encoding: string;
  chars: number;
  missing: string[];
};

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
    names: Record<TemplateKey, string>;
  };
}) {
  const [key, setKey] = useState<TemplateKey>(templates[0]?.templateKey ?? "missed_call_recovery");
  const [locale, setLocale] = useState<"en" | "fr">("fr");
  const current = templates.find((t) => t.templateKey === key && t.locale === locale) ?? templates[0];
  const [body, setBody] = useState(current?.body ?? "");
  const [selectedId, setSelectedId] = useState(current?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keys = useMemo(
    () => [...new Set(templates.map((t) => t.templateKey))],
    [templates],
  );

  function choose(nextKey: TemplateKey, nextLocale: "en" | "fr") {
    const row = templates.find((t) => t.templateKey === nextKey && t.locale === nextLocale);
    setKey(nextKey);
    setLocale(nextLocale);
    setBody(row?.body ?? "");
    setSelectedId(row?.id ?? "");
    setPreview(null);
    setMessage(null);
    setError(null);
  }

  function insertVariable(name: string) {
    setBody((value) => `${value}{{${name}}}`);
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/businesses/${organizationId}/automation-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", templateKey: key, locale, body }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string; preview?: Preview } | null;
    setBusy(false);
    if (!res.ok || !data?.preview) {
      setError(data?.error || labels.error);
      return;
    }
    setPreview(data.preview);
  }

  async function save(reset = false) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(
      `/api/businesses/${organizationId}/automation-templates/${selectedId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset ? { reset: true } : { body }),
      },
    );
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      template?: TemplateRecord;
    } | null;
    setBusy(false);
    if (!res.ok || !data?.template) {
      setError(data?.error || labels.error);
      return;
    }
    setBody(data.template.body);
    setMessage(labels.saved);
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
              onClick={() => insertVariable(name)}
              className="rounded-md border border-navy/15 px-2 py-1 font-mono text-xs text-navy"
            >
              {`{{${name}}}`}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          className="w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
        />
        <p className="text-xs text-navy/60">
          {labels.chars}: {body.length}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void runPreview()} className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy">
            {labels.preview}
          </button>
          <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
            {labels.save}
          </button>
          <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy">
            {labels.reset}
          </button>
        </div>
        {preview ? (
          <div className="rounded-md bg-[var(--color-surface,#f7f5f1)] p-3 text-sm text-navy">
            <p>{preview.body}</p>
            <p className="mt-2 text-xs text-navy/60">
              {labels.chars}: {preview.chars} · {labels.segments}: {preview.segments} ({preview.encoding})
            </p>
            {preview.segments > 1 ? (
              <p className="mt-1 text-xs text-navy">{labels.segmentWarning}</p>
            ) : null}
            {preview.missing.length > 0 ? (
              <p className="mt-1 text-xs text-red-800">
                {labels.missing}: {preview.missing.join(", ")}
              </p>
            ) : null}
            {preview.errors.length > 0 ? (
              <p className="mt-1 text-xs text-red-800">{preview.errors.join(", ")}</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-800">{error}</p> : null}
        {message ? <p className="text-sm text-navy">{message}</p> : null}
      </div>
    </div>
  );
}
