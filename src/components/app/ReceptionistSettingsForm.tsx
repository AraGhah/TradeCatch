"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ProfileSettings } from "@/product/receptionist/profile";

type Hours = { start: string; end: string; days: number[] };

type DeptRow = { name: string; phoneE164: string; keywords: string };
type FaqRow = { keywords: string; answerFr: string; answerEn: string };

const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy disabled:bg-navy/5";
const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";
const BUTTON_GHOST =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

const words = (raw: string) =>
  raw
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);

export function ReceptionistSettingsForm({
  readOnly,
  initial,
  defaultHours,
}: {
  readOnly: boolean;
  initial: ProfileSettings;
  defaultHours: Hours;
}) {
  const t = useTranslations("app.receptionist");
  const router = useRouter();

  const [languages, setLanguages] = useState<("fr" | "en")[]>(initial.languages);
  const [defaultLanguage, setDefaultLanguage] = useState(initial.defaultLanguage);
  const [greetingFr, setGreetingFr] = useState(initial.greetingFr ?? "");
  const [greetingEn, setGreetingEn] = useState(initial.greetingEn ?? "");
  const [afterFr, setAfterFr] = useState(initial.afterHoursMessageFr ?? "");
  const [afterEn, setAfterEn] = useState(initial.afterHoursMessageEn ?? "");
  const [customHours, setCustomHours] = useState(Boolean(initial.businessHours));
  const [hours, setHours] = useState<Hours>(initial.businessHours ?? defaultHours);
  const [personality, setPersonality] = useState(initial.personality ?? "");
  const [facts, setFacts] = useState(initial.businessFacts ?? "");
  const [routing, setRouting] = useState<DeptRow[]>(
    initial.routing.map((r) => ({ name: r.name, phoneE164: r.phoneE164, keywords: r.keywords.join(", ") })),
  );
  const [faqs, setFaqs] = useState<FaqRow[]>(
    initial.faqs.map((f) => ({ keywords: f.keywords.join(", "), answerFr: f.answerFr, answerEn: f.answerEn })),
  );
  const [emergency, setEmergency] = useState(initial.emergencyTransferE164 ?? "");
  const [fallback, setFallback] = useState(initial.fallbackTransferE164 ?? "");
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail ?? "");
  const [notifySms, setNotifySms] = useState(initial.notifySmsE164 ?? "");
  const [collectTime, setCollectTime] = useState(initial.collectPreferredTime);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);

  const days = t.raw("days") as string[];

  function toggleLanguage(lang: "fr" | "en") {
    setLanguages((prev) => {
      const next = prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang];
      const safe = next.length > 0 ? next : prev; // never zero languages
      if (!safe.includes(defaultLanguage)) setDefaultLanguage(safe[0]!);
      return safe;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    setIssues([]);
    const body = {
      languages,
      defaultLanguage,
      greetingFr,
      greetingEn,
      afterHoursMessageFr: afterFr,
      afterHoursMessageEn: afterEn,
      ...(customHours ? { businessHours: hours } : {}),
      personality,
      businessFacts: facts,
      routing: routing
        .filter((r) => r.name.trim() || r.phoneE164.trim())
        .map((r) => ({ name: r.name.trim(), phoneE164: r.phoneE164.trim(), keywords: words(r.keywords) })),
      faqs: faqs
        .filter((f) => f.answerFr.trim() || f.answerEn.trim() || f.keywords.trim())
        .map((f) => ({ keywords: words(f.keywords), answerFr: f.answerFr.trim(), answerEn: f.answerEn.trim() })),
      emergencyTransferE164: emergency.trim(),
      fallbackTransferE164: fallback.trim(),
      notifyEmail: notifyEmail.trim(),
      notifySmsE164: notifySms.trim(),
      collectPreferredTime: collectTime,
    };
    try {
      const res = await fetch("/api/app/receptionist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
      } | null;
      if (!res.ok) {
        setError(data?.error || t("error"));
        setIssues(data?.issues ?? []);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  const dis = readOnly || busy;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
      {/* Languages */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("languagesTitle")}</legend>
        <div className="mt-2 flex flex-wrap items-center gap-5 text-sm text-navy">
          {(["fr", "en"] as const).map((l) => (
            <label key={l} className="flex items-center gap-2">
              <input type="checkbox" checked={languages.includes(l)} onChange={() => toggleLanguage(l)} />
              {l === "fr" ? t("langFr") : t("langEn")}
            </label>
          ))}
          <label className="flex items-center gap-2">
            {t("defaultLanguage")}
            <select
              value={defaultLanguage}
              onChange={(e) => setDefaultLanguage(e.target.value === "en" ? "en" : "fr")}
              className="rounded-md border border-navy/20 px-2 py-1 text-sm"
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l === "fr" ? t("langFr") : t("langEn")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      {/* Greetings */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("greetingsTitle")}</legend>
        <p className="mt-1 text-xs text-navy/60">{t("greetingHelp")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            [t("greetingFr"), greetingFr, setGreetingFr],
            [t("greetingEn"), greetingEn, setGreetingEn],
            [t("afterHoursFr"), afterFr, setAfterFr],
            [t("afterHoursEn"), afterEn, setAfterEn],
          ].map(([label, value, set]) => (
            <label key={label as string} className="text-xs text-navy/70">
              {label as string}
              <textarea
                rows={3}
                maxLength={400}
                value={value as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
                className={INPUT}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {/* Hours */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("hoursTitle")}</legend>
        <p className="mt-1 text-xs text-navy/60">{t("hoursIntro")}</p>
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={customHours} onChange={(e) => setCustomHours(e.target.checked)} />
          {t("hoursCustom")}
        </label>
        {customHours ? (
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="text-xs text-navy/70">
              {t("hoursStart")}
              <input type="time" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} className={INPUT} />
            </label>
            <label className="text-xs text-navy/70">
              {t("hoursEnd")}
              <input type="time" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} className={INPUT} />
            </label>
            <div className="flex flex-wrap gap-3 text-sm text-navy">
              {days.map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={hours.days.includes(i)}
                    onChange={() =>
                      setHours({
                        ...hours,
                        days: hours.days.includes(i)
                          ? hours.days.filter((x) => x !== i)
                          : [...hours.days, i].sort(),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-navy/60">
            {t("hoursDefault", {
              hours: `${defaultHours.start}–${defaultHours.end} (${defaultHours.days.map((i) => days[i]).join(", ")})`,
            })}
          </p>
        )}
      </fieldset>

      {/* Knowledge */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("knowledgeTitle")}</legend>
        <label className="mt-2 block text-xs text-navy/70">
          {t("facts")}
          <textarea rows={5} maxLength={2000} value={facts} onChange={(e) => setFacts(e.target.value)} className={INPUT} />
          <span className="mt-1 block text-navy/70">{t("factsHelp")}</span>
        </label>
        <label className="mt-3 block text-xs text-navy/70">
          {t("personality")}
          <input maxLength={600} value={personality} onChange={(e) => setPersonality(e.target.value)} className={INPUT} />
          <span className="mt-1 block text-navy/70">{t("personalityHelp")}</span>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={collectTime} onChange={(e) => setCollectTime(e.target.checked)} />
          {t("collectTime")}
        </label>
      </fieldset>

      {/* Routing */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("routingTitle")}</legend>
        <p className="mt-1 text-xs text-navy/60">{t("routingIntro")}</p>
        {routing.map((row, i) => (
          <div key={i} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
            <label className="text-xs text-navy/70">
              {t("deptName")}
              <input value={row.name} maxLength={60} onChange={(e) => setRouting(routing.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className={INPUT} />
            </label>
            <label className="text-xs text-navy/70">
              {t("deptPhone")}
              <input value={row.phoneE164} placeholder="+14385551234" onChange={(e) => setRouting(routing.map((r, j) => (j === i ? { ...r, phoneE164: e.target.value } : r)))} className={INPUT} />
            </label>
            <label className="text-xs text-navy/70">
              {t("deptKeywords")}
              <input value={row.keywords} onChange={(e) => setRouting(routing.map((r, j) => (j === i ? { ...r, keywords: e.target.value } : r)))} className={INPUT} />
            </label>
            <button type="button" className={BUTTON_GHOST} onClick={() => setRouting(routing.filter((_, j) => j !== i))}>
              {t("removeRow")}
            </button>
          </div>
        ))}
        <p className="mt-2 text-xs text-navy/70">{t("phoneHelp")}</p>
        <button
          type="button"
          className={`${BUTTON_GHOST} mt-3`}
          disabled={routing.length >= 8}
          onClick={() => setRouting([...routing, { name: "", phoneE164: "", keywords: "" }])}
        >
          {t("addDept")}
        </button>
      </fieldset>

      {/* FAQ */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("faqTitle")}</legend>
        <p className="mt-1 text-xs text-navy/60">{t("faqIntro")}</p>
        {faqs.map((row, i) => (
          <div key={i} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="text-xs text-navy/70">
              {t("faqKeywords")}
              <input value={row.keywords} onChange={(e) => setFaqs(faqs.map((r, j) => (j === i ? { ...r, keywords: e.target.value } : r)))} className={INPUT} />
            </label>
            <label className="text-xs text-navy/70">
              {t("faqAnswerFr")}
              <textarea rows={2} maxLength={500} value={row.answerFr} onChange={(e) => setFaqs(faqs.map((r, j) => (j === i ? { ...r, answerFr: e.target.value } : r)))} className={INPUT} />
            </label>
            <label className="text-xs text-navy/70">
              {t("faqAnswerEn")}
              <textarea rows={2} maxLength={500} value={row.answerEn} onChange={(e) => setFaqs(faqs.map((r, j) => (j === i ? { ...r, answerEn: e.target.value } : r)))} className={INPUT} />
            </label>
            <button type="button" className={BUTTON_GHOST} onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}>
              {t("removeRow")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BUTTON_GHOST} mt-3`}
          disabled={faqs.length >= 20}
          onClick={() => setFaqs([...faqs, { keywords: "", answerFr: "", answerEn: "" }])}
        >
          {t("addFaq")}
        </button>
      </fieldset>

      {/* Emergency + notifications */}
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("emergencyTitle")}</legend>
        <p className="mt-1 text-xs text-navy/60">{t("emergencyIntro")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("emergencyPhone")}
            <input value={emergency} placeholder="+14385551234" onChange={(e) => setEmergency(e.target.value)} className={INPUT} />
          </label>
          <label className="text-xs text-navy/70">
            {t("fallbackPhone")}
            <input value={fallback} placeholder="+14385551234" onChange={(e) => setFallback(e.target.value)} className={INPUT} />
          </label>
        </div>
        <p className="mt-2 text-xs text-navy/70">
          {t("phoneHelp")} {t("linesBlank")}
        </p>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">{t("notifyTitle")}</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("notifyEmail")}
            <input type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} className={INPUT} />
          </label>
          <label className="text-xs text-navy/70">
            {t("notifySms")}
            <input value={notifySms} placeholder="+14385551234" onChange={(e) => setNotifySms(e.target.value)} className={INPUT} />
          </label>
        </div>
      </fieldset>

      {error ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">{error}</p>
          {issues.length > 0 ? (
            <>
              <p className="mt-1">{t("issuesTitle")}</p>
              <ul className="mt-1 list-disc pl-5">
                {issues.map((i, k) => (
                  <li key={k}>
                    {i.field}: {i.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          {t("saved")}
        </p>
      ) : null}

      <div>
        <button type="submit" disabled={dis} className={BUTTON}>
          {busy ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
