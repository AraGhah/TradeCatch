"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type {
  EmailEnrollment,
  EmailSequence,
  EmailTemplate,
} from "@/product/email-automation/types";

const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy";
const BUTTON =
  "rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";
const BUTTON_GHOST =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";
const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";

function parseVars(raw: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) vars[key] = line.slice(idx + 1).trim();
  }
  return vars;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/app/email-automation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error((data?.error as string) || `HTTP ${res.status}`);
  return data ?? {};
}

export function EmailAutomationPanel({
  locale,
  templates,
  sequences,
  enrollments,
  autoEnrollSequenceId,
}: {
  autoEnrollSequenceId?: string;
  locale: "en" | "fr";
  templates: EmailTemplate[];
  sequences: EmailSequence[];
  enrollments: EmailEnrollment[];
}) {
  const t = useTranslations("app");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-enroll website leads
  const [autoId, setAutoId] = useState(autoEnrollSequenceId ?? "");
  const [autoSaved, setAutoSaved] = useState(false);

  // Enroll form
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [varsRaw, setVarsRaw] = useState("");

  // Template editor
  const blank = { id: undefined as string | undefined, name: "", locale, subject: "", body: "" };
  const [draft, setDraft] = useState(blank);
  const [preview, setPreview] = useState<{ subject: string; text: string; variables: string[] } | null>(null);

  // Sequence builder
  const [seqName, setSeqName] = useState("");
  const [steps, setSteps] = useState<{ templateId: string; delayDays: number }[]>([
    { templateId: templates[0]?.id ?? "", delayDays: 2 },
  ]);

  const templateName = (id: string) => templates.find((x) => x.id === id)?.name ?? id;
  const sequenceById = (id: string) => sequences.find((s) => s.id === id);
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(locale === "fr" ? "fr-CA" : "en-CA") : "—";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("email.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {/* Auto-enroll website leads (off by default; consent + email required) */}
      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          setAutoSaved(false);
          void run(async () => {
            await post({ action: "set-auto-enroll", sequenceId: autoId || null });
            setAutoSaved(true);
          });
        }}
      >
        <p className="text-sm font-semibold text-navy">{t("email.autoTitle")}</p>
        <p className="mt-1 text-xs text-navy/60">{t("email.autoIntro")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-navy/70">
            {t("email.autoSequence")}
            <select value={autoId} onChange={(e) => setAutoId(e.target.value)} className={INPUT}>
              <option value="">{t("email.autoOff")}</option>
              {sequences.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} className={BUTTON}>
            {t("email.autoSave")}
          </button>
          {autoSaved ? (
            <span role="status" className="text-sm text-green-800">
              {t("email.autoSaved")}
            </span>
          ) : null}
        </div>
      </form>

      {/* Enroll */}
      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await post({ action: "enroll", sequenceId, email, name: name || undefined, vars: parseVars(varsRaw) });
            setEmail("");
            setName("");
            setVarsRaw("");
          });
        }}
      >
        <p className="text-sm font-semibold text-navy">{t("email.enrollTitle")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-navy/70">
            {t("email.sequence")}
            <select required value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className={INPUT}>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : ` (${t("email.paused")})`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-navy/70">
            {t("email.contactEmail")}
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
          </label>
          <label className="text-xs text-navy/70">
            {t("email.contactName")}
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </label>
        </div>
        <label className="mt-3 block text-xs text-navy/70">
          {t("email.vars")}
          <textarea
            value={varsRaw}
            onChange={(e) => setVarsRaw(e.target.value)}
            rows={2}
            placeholder={"quote_ref=Q-1042\nservice=thermopompe"}
            className={`${INPUT} font-mono`}
          />
        </label>
        <button type="submit" disabled={busy || !sequenceId} className={`${BUTTON} mt-3`}>
          {t("email.enroll")}
        </button>
      </form>

      {/* Enrollments */}
      <section className={CARD}>
        <p className="text-sm font-semibold text-navy">{t("email.enrollmentsTitle")}</p>
        {enrollments.length === 0 ? (
          <p className="mt-2 text-sm text-navy/60">{t("email.noEnrollments")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-navy/60">
                <tr>
                  <th className="py-2 pr-3">{t("email.contactEmail")}</th>
                  <th className="py-2 pr-3">{t("email.sequence")}</th>
                  <th className="py-2 pr-3">{t("email.status")}</th>
                  <th className="py-2 pr-3">{t("email.step")}</th>
                  <th className="py-2 pr-3">{t("email.nextSend")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/10">
                {enrollments.map((en) => {
                  const seq = sequenceById(en.sequenceId);
                  return (
                    <tr key={en.id}>
                      <td className="py-2 pr-3 text-navy">
                        {en.email}
                        {en.name ? <span className="block text-xs text-navy/60">{en.name}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-navy/80">{seq?.name ?? "—"}</td>
                      <td className="py-2 pr-3 text-navy/80">
                        {t(`email.statuses.${en.status}`)}
                        {en.stopReason ? ` · ${en.stopReason}` : ""}
                      </td>
                      <td className="py-2 pr-3 text-navy/80">
                        {Math.min(en.currentStep, seq?.steps.length ?? 0)}/{seq?.steps.length ?? "?"}
                      </td>
                      <td className="py-2 pr-3 text-navy/80">{en.status === "active" ? fmt(en.nextSendAt) : "—"}</td>
                      <td className="py-2 text-right">
                        {en.status === "active" ? (
                          <span className="inline-flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              className={BUTTON_GHOST}
                              onClick={() => void run(async () => void (await post({ action: "mark-replied", email: en.email })))}
                            >
                              {t("email.replied")}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className={BUTTON_GHOST}
                              onClick={() => void run(async () => void (await post({ action: "stop", enrollmentId: en.id })))}
                            >
                              {t("email.stop")}
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sequences */}
      <section className={CARD}>
        <p className="text-sm font-semibold text-navy">{t("email.sequencesTitle")}</p>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {sequences.map((s) => (
            <li key={s.id} className="rounded-md bg-navy/5 px-3 py-2">
              <span className="font-semibold text-navy">{s.name}</span>
              <span className="text-navy/60">
                {" · "}
                {s.steps
                  .map((st) => `+${Math.round((st.delayHours / 24) * 10) / 10} ${t("email.days")} → ${templateName(st.templateId)}`)
                  .join("  ·  ")}
                {s.stopOnReply ? ` · ${t("email.stopOnReply")}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 border-t border-navy/10 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await post({
                action: "save-sequence",
                name: seqName,
                steps: steps.map((s) => ({ templateId: s.templateId, delayHours: Math.round(s.delayDays * 24) })),
                stopOnReply: true,
              });
              setSeqName("");
            });
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-navy/60">{t("email.newSequence")}</p>
          <label className="mt-2 block text-xs text-navy/70">
            {t("email.name")}
            <input required value={seqName} onChange={(e) => setSeqName(e.target.value)} className={INPUT} />
          </label>
          {steps.map((step, i) => (
            <div key={i} className="mt-2 grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <label className="text-xs text-navy/70">
                {t("email.stepTemplate", { n: i + 1 })}
                <select
                  value={step.templateId}
                  onChange={(e) => setSteps(steps.map((s, j) => (j === i ? { ...s, templateId: e.target.value } : s)))}
                  className={INPUT}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-28 text-xs text-navy/70">
                {t("email.delayDays")}
                <input
                  type="number"
                  min={0}
                  max={90}
                  step={0.5}
                  value={step.delayDays}
                  onChange={(e) => setSteps(steps.map((s, j) => (j === i ? { ...s, delayDays: Number(e.target.value) } : s)))}
                  className={INPUT}
                />
              </label>
              <button
                type="button"
                className={BUTTON_GHOST}
                disabled={steps.length === 1}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                aria-label={t("email.removeStep")}
              >
                ×
              </button>
            </div>
          ))}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={BUTTON_GHOST}
              disabled={steps.length >= 10}
              onClick={() => setSteps([...steps, { templateId: templates[0]?.id ?? "", delayDays: 3 }])}
            >
              {t("email.addStep")}
            </button>
            <button type="submit" disabled={busy} className={BUTTON}>
              {t("email.saveSequence")}
            </button>
          </div>
        </form>
      </section>

      {/* Templates */}
      <section className={CARD}>
        <p className="text-sm font-semibold text-navy">{t("email.templatesTitle")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={BUTTON_GHOST}
              onClick={() => {
                setDraft({ id: tpl.id, name: tpl.name, locale: tpl.locale, subject: tpl.subject, body: tpl.body });
                setPreview(null);
              }}
            >
              {tpl.name}
            </button>
          ))}
          <button type="button" className={BUTTON_GHOST} onClick={() => { setDraft(blank); setPreview(null); }}>
            + {t("email.newTemplate")}
          </button>
        </div>
        <form
          className="mt-4 border-t border-navy/10 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const data = await post({ action: "save-template", ...draft });
              const saved = data.template as EmailTemplate | undefined;
              if (saved) setDraft({ ...draft, id: saved.id });
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-xs text-navy/70">
              {t("email.name")}
              <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={INPUT} />
            </label>
            <label className="text-xs text-navy/70">
              {t("email.language")}
              <select
                value={draft.locale}
                onChange={(e) => setDraft({ ...draft, locale: e.target.value === "en" ? "en" : "fr" })}
                className={INPUT}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block text-xs text-navy/70">
            {t("email.subject")}
            <input required value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={INPUT} />
          </label>
          <label className="mt-3 block text-xs text-navy/70">
            {t("email.body")}
            <textarea
              required
              rows={10}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className={`${INPUT} font-mono`}
            />
          </label>
          <p className="mt-2 text-xs text-navy/60">{t("email.syntaxHelp")}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !draft.subject || !draft.body}
              className={BUTTON_GHOST}
              onClick={() =>
                void run(async () => {
                  const data = await post({
                    action: "preview",
                    subject: draft.subject,
                    body: draft.body,
                    name: "Marie Tremblay",
                    vars: { quote_ref: "Q-1042", service: locale === "fr" ? "thermopompe" : "heat pump" },
                  });
                  setPreview(data.preview as { subject: string; text: string; variables: string[] });
                })
              }
            >
              {t("email.preview")}
            </button>
            <button type="submit" disabled={busy} className={BUTTON}>
              {draft.id ? t("email.saveTemplate") : t("email.createTemplate")}
            </button>
          </div>
          {preview ? (
            <div className="mt-4 rounded-md bg-navy/5 px-4 py-3 text-sm">
              <p className="font-semibold text-navy">{preview.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-navy/80">{preview.text}</pre>
              <p className="mt-2 text-xs text-navy/60">
                {t("email.variablesUsed")}: {preview.variables.join(", ") || "—"}
              </p>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
