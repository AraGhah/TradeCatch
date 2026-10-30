"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ProfileSettings } from "@/product/receptionist/profile";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import {
  buildPromptValues,
  DEFAULT_SYSTEM_PROMPT,
  MAX_SYSTEM_PROMPT_CHARS,
  PROMPT_PLACEHOLDERS,
  renderPromptTemplate,
} from "@/product/receptionist/system-prompt";

type Hours = { start: string; end: string; days: number[] };

type DeptRow = { name: string; phoneE164: string; keywords: string };
type FaqRow = {
  question: string;
  keywords: string;
  answerFr: string;
  answerEn: string;
};

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

const listLines = (raw: string) =>
  raw
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);

export function ReceptionistSettingsForm({
  organizationId,
  readOnly,
  initial,
  defaultHours,
  voiceCapabilities,
}: {
  organizationId?: string;
  readOnly: boolean;
  initial: ProfileSettings;
  defaultHours: Hours;
  /** When omitted (ops tooling), every setting stays editable. */
  voiceCapabilities?: VoiceCapabilities;
}) {
  const t = useTranslations("app.receptionist");
  const router = useRouter();
  const canPhoneBook = voiceCapabilities?.phoneBooking !== false;
  const canTransfer = voiceCapabilities?.transfer !== false;
  const canEmergencyRoute = voiceCapabilities?.emergencyRouting !== false;

  const [receptionistName, setReceptionistName] = useState(
    initial.receptionistName ?? "",
  );
  const [languages, setLanguages] = useState<("fr" | "en")[]>(
    initial.languages,
  );
  const [defaultLanguage, setDefaultLanguage] = useState(
    initial.defaultLanguage,
  );
  const [style, setStyle] = useState(initial.communicationStyle);
  const [speed, setSpeed] = useState(initial.speakingSpeed);
  const [callMode, setCallMode] = useState(initial.callHandlingMode);
  const [greetingFr, setGreetingFr] = useState(initial.greetingFr ?? "");
  const [greetingEn, setGreetingEn] = useState(initial.greetingEn ?? "");
  const [afterFr, setAfterFr] = useState(initial.afterHoursMessageFr ?? "");
  const [afterEn, setAfterEn] = useState(initial.afterHoursMessageEn ?? "");
  const [customHours, setCustomHours] = useState(
    Boolean(initial.businessHours),
  );
  const [hours, setHours] = useState<Hours>(
    initial.businessHours ?? defaultHours,
  );
  const [personality, setPersonality] = useState(initial.personality ?? "");
  const [companyName, setCompanyName] = useState(
    initial.knowledge.companyName ?? "",
  );
  const [industry, setIndustry] = useState(initial.knowledge.industry ?? "");
  const [services, setServices] = useState(
    initial.knowledge.services.join(", "),
  );
  const [areas, setAreas] = useState(initial.knowledge.serviceAreas.join(", "));
  const [emergencySvc, setEmergencySvc] = useState(
    initial.knowledge.emergencyServices,
  );
  const [emergencyHours, setEmergencyHours] = useState(
    initial.knowledge.emergencyHours ?? "",
  );
  const [prices, setPrices] = useState(initial.knowledge.startingPrices ?? "");
  const [address, setAddress] = useState(
    initial.knowledge.businessAddress ?? "",
  );
  const [businessPhone, setBusinessPhone] = useState(
    initial.knowledge.businessPhone ?? "",
  );
  const [apptAvailability, setApptAvailability] = useState(
    initial.knowledge.appointmentAvailability ?? "",
  );
  const [extraRules, setExtraRules] = useState(
    initial.knowledge.additionalInstructions ?? "",
  );
  // Blank in storage means "TradeCatch default", so the editor starts from it.
  const [systemPrompt, setSystemPrompt] = useState(
    initial.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );
  const [showPreview, setShowPreview] = useState(false);
  const [facts, setFacts] = useState(initial.businessFacts ?? "");
  const [routing, setRouting] = useState<DeptRow[]>(
    initial.routing.map((r) => ({
      name: r.name,
      phoneE164: r.phoneE164,
      keywords: r.keywords.join(", "),
    })),
  );
  const [faqs, setFaqs] = useState<FaqRow[]>(
    initial.faqs.map((f) => ({
      question: f.question ?? "",
      keywords: f.keywords.join(", "),
      answerFr: f.answerFr,
      answerEn: f.answerEn,
    })),
  );
  const [emergency, setEmergency] = useState(
    initial.emergencyTransferE164 ?? "",
  );
  const [primaryTransfer, setPrimaryTransfer] = useState(
    initial.transferSettings.primaryTransferE164 ??
      initial.fallbackTransferE164 ??
      "",
  );
  const [secondaryTransfer, setSecondaryTransfer] = useState(
    initial.transferSettings.secondaryTransferE164 ?? "",
  );
  const [transferTimeout, setTransferTimeout] = useState(
    initial.transferSettings.timeoutSeconds,
  );
  const [failedTransfer, setFailedTransfer] = useState(
    initial.transferSettings.failedAction,
  );
  const [duration, setDuration] = useState(
    initial.appointmentSettings.durationMinutes,
  );
  const [buffer, setBuffer] = useState(
    initial.appointmentSettings.bufferMinutes,
  );
  const [notice, setNotice] = useState(
    initial.appointmentSettings.bookingNoticeHours,
  );
  const [maxDaily, setMaxDaily] = useState(
    initial.appointmentSettings.maxDailyBookings?.toString() ?? "",
  );
  const [confirmMethod, setConfirmMethod] = useState(
    initial.appointmentSettings.confirmationMethod,
  );
  const [bookable, setBookable] = useState(
    initial.appointmentSettings.bookableServices.join(", "),
  );
  const [phoneBooking, setPhoneBooking] = useState(
    initial.appointmentSettings.phoneBooking ?? false,
  );
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail ?? "");
  const [notifySms, setNotifySms] = useState(initial.notifySmsE164 ?? "");
  const [collectTime, setCollectTime] = useState(initial.collectPreferredTime);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>(
    [],
  );

  const days = t.raw("days") as string[];

  function toggleLanguage(lang: "fr" | "en") {
    setLanguages((prev) => {
      const next = prev.includes(lang)
        ? prev.filter((l) => l !== lang)
        : [...prev, lang];
      const safe = next.length > 0 ? next : prev;
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
      receptionistName,
      languages,
      defaultLanguage,
      communicationStyle: style,
      speakingSpeed: speed,
      callHandlingMode: callMode,
      greetingFr,
      greetingEn,
      afterHoursMessageFr: afterFr,
      afterHoursMessageEn: afterEn,
      ...(customHours ? { businessHours: hours } : {}),
      personality,
      businessFacts: facts,
      // Unchanged default is stored as blank so it keeps following TradeCatch's.
      systemPrompt:
        systemPrompt.trim() === DEFAULT_SYSTEM_PROMPT.trim()
          ? ""
          : systemPrompt,
      knowledge: {
        businessPhone,
        appointmentAvailability: apptAvailability,
        companyName,
        industry,
        services: listLines(services),
        serviceAreas: listLines(areas),
        emergencyServices: emergencySvc,
        emergencyHours,
        startingPrices: prices,
        businessAddress: address,
        additionalInstructions: extraRules,
      },
      routing: routing
        .filter((r) => r.name.trim() || r.phoneE164.trim())
        .map((r) => ({
          name: r.name.trim(),
          phoneE164: r.phoneE164.trim(),
          keywords: words(r.keywords),
        })),
      faqs: faqs
        .filter(
          (f) =>
            f.answerFr.trim() ||
            f.answerEn.trim() ||
            f.keywords.trim() ||
            f.question.trim(),
        )
        .map((f) => ({
          question: f.question.trim() || undefined,
          keywords: words(f.keywords),
          answerFr: f.answerFr.trim(),
          answerEn: f.answerEn.trim(),
        })),
      emergencyTransferE164: emergency.trim(),
      fallbackTransferE164: primaryTransfer.trim(),
      transferSettings: {
        primaryTransferE164: primaryTransfer.trim(),
        secondaryTransferE164: secondaryTransfer.trim(),
        timeoutSeconds: transferTimeout,
        failedAction: failedTransfer,
        conditions: ["caller_request", "urgent", "unknown_answer"],
        transferHours: "always",
      },
      appointmentSettings: {
        calendarProvider: "simulated",
        durationMinutes: duration,
        bufferMinutes: buffer,
        bookingNoticeHours: notice,
        maxDailyBookings: maxDaily ? Number(maxDaily) : undefined,
        confirmationMethod: confirmMethod,
        bookableServices: listLines(bookable),
        phoneBooking,
      },
      notifyEmail: notifyEmail.trim(),
      notifySmsE164: notifySms.trim(),
      collectPreferredTime: collectTime,
    };
    try {
      const url = organizationId
        ? `/api/businesses/${organizationId}/ai-receptionist`
        : "/api/app/receptionist";
      const res = await fetch(url, {
        method: organizationId ? "PATCH" : "PUT",
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

  const promptPreview = showPreview
    ? renderPromptTemplate(
        systemPrompt,
        buildPromptValues({
          businessName: companyName.trim() || t("promptPreviewCompany"),
          services: listLines(services),
          serviceAreas: listLines(areas),
          businessAddress: address,
          businessPhone,
          emergencyServices: emergencySvc,
          emergencyHours,
          hasEmergencyLine: emergency.trim() !== "",
          appointmentAvailability: apptAvailability,
          phoneBooking,
          businessHours: customHours ? hours : defaultHours,
          timezone: t("promptPreviewTimezone"),
        }),
      )
    : "";

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("identityTitle")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("receptionistName")}
            <input
              maxLength={60}
              value={receptionistName}
              onChange={(e) => setReceptionistName(e.target.value)}
              className={INPUT}
              placeholder="Sophie"
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("communicationStyle")}
            <select
              className={INPUT}
              value={style}
              onChange={(e) =>
                setStyle(
                  e.target.value as ProfileSettings["communicationStyle"],
                )
              }
            >
              <option value="professional_friendly">
                {t("styles.professional_friendly")}
              </option>
              <option value="professional">{t("styles.professional")}</option>
              <option value="warm">{t("styles.warm")}</option>
              <option value="brief">{t("styles.brief")}</option>
            </select>
          </label>
          <label className="text-xs text-navy/70">
            {t("speakingSpeed")}
            <select
              className={INPUT}
              value={speed}
              onChange={(e) =>
                setSpeed(e.target.value as ProfileSettings["speakingSpeed"])
              }
            >
              <option value="slow">{t("speeds.slow")}</option>
              <option value="normal">{t("speeds.normal")}</option>
              <option value="fast">{t("speeds.fast")}</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("languagesTitle")}
        </legend>
        <div className="mt-2 flex flex-wrap items-center gap-5 text-sm text-navy">
          {(["fr", "en"] as const).map((l) => (
            <label key={l} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={languages.includes(l)}
                onChange={() => toggleLanguage(l)}
              />
              {l === "fr" ? t("langFr") : t("langEn")}
            </label>
          ))}
          <label className="flex items-center gap-2">
            {t("defaultLanguage")}
            <select
              value={defaultLanguage}
              onChange={(e) =>
                setDefaultLanguage(e.target.value === "en" ? "en" : "fr")
              }
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

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("greetingsTitle")}
        </legend>
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

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("callHandlingTitle")}
        </legend>
        <p className="mt-1 text-xs text-navy/60">{t("callHandlingIntro")}</p>
        <label className="mt-3 block text-xs text-navy/70">
          {t("callHandlingMode")}
          <select
            className={INPUT}
            value={callMode}
            onChange={(e) =>
              setCallMode(e.target.value as ProfileSettings["callHandlingMode"])
            }
          >
            {(
              [
                "always",
                "business_hours",
                "after_hours",
                "overflow",
                "disabled",
              ] as const
            ).map((m) => (
              <option key={m} value={m}>
                {t(`modes.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={customHours}
            onChange={(e) => setCustomHours(e.target.checked)}
          />
          {t("hoursCustom")}
        </label>
        {customHours ? (
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="text-xs text-navy/70">
              {t("hoursStart")}
              <input
                type="time"
                value={hours.start}
                onChange={(e) => setHours({ ...hours, start: e.target.value })}
                className={INPUT}
              />
            </label>
            <label className="text-xs text-navy/70">
              {t("hoursEnd")}
              <input
                type="time"
                value={hours.end}
                onChange={(e) => setHours({ ...hours, end: e.target.value })}
                className={INPUT}
              />
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

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("knowledgeTitle")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("companyName")}
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("industry")}
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("services")}
            <input
              value={services}
              onChange={(e) => setServices(e.target.value)}
              className={INPUT}
              placeholder={t("servicesPlaceholder")}
            />
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("serviceAreas")}
            <input
              value={areas}
              onChange={(e) => setAreas(e.target.value)}
              className={INPUT}
              placeholder={t("areasPlaceholder")}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-navy sm:col-span-2">
            <input
              type="checkbox"
              checked={emergencySvc}
              onChange={(e) => setEmergencySvc(e.target.checked)}
            />
            {t("emergencyServices")}
          </label>
          {emergencySvc ? (
            <label className="text-xs text-navy/70">
              {t("emergencyHours")}
              <input
                value={emergencyHours}
                onChange={(e) => setEmergencyHours(e.target.value)}
                className={INPUT}
                placeholder="24/7"
              />
            </label>
          ) : null}
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("startingPrices")}
            <textarea
              rows={2}
              maxLength={500}
              value={prices}
              onChange={(e) => setPrices(e.target.value)}
              className={INPUT}
            />
            <span className="mt-1 block text-navy/60">{t("pricesHelp")}</span>
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("businessAddress")}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("businessPhone")}
            <input
              maxLength={40}
              value={businessPhone}
              onChange={(e) => setBusinessPhone(e.target.value)}
              className={INPUT}
              placeholder="+1 514 555 0123"
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("appointmentAvailability")}
            <input
              maxLength={300}
              value={apptAvailability}
              onChange={(e) => setApptAvailability(e.target.value)}
              className={INPUT}
            />
            <span className="mt-1 block text-navy/60">
              {t("appointmentAvailabilityHelp")}
            </span>
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("additionalInstructions")}
            <textarea
              rows={3}
              maxLength={2000}
              value={extraRules}
              onChange={(e) => setExtraRules(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("facts")}
            <textarea
              rows={3}
              maxLength={2000}
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              className={INPUT}
            />
            <span className="mt-1 block text-navy/60">{t("factsHelp")}</span>
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("personality")}
            <input
              maxLength={600}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-navy sm:col-span-2">
            <input
              type="checkbox"
              checked={collectTime}
              onChange={(e) => setCollectTime(e.target.checked)}
            />
            {t("collectTime")}
          </label>
        </div>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("promptTitle")}
        </legend>
        <p className="mt-1 text-xs text-navy/60">{t("promptHelp")}</p>
        <p className="mt-2 flex flex-wrap gap-1 text-xs text-navy/70">
          {PROMPT_PLACEHOLDERS.map((p) => (
            <code key={p} className="rounded bg-navy/5 px-1.5 py-0.5">
              {`{${p}}`}
            </code>
          ))}
        </p>
        <textarea
          rows={18}
          maxLength={MAX_SYSTEM_PROMPT_CHARS}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          className={`${INPUT} font-mono text-xs leading-relaxed`}
          aria-label={t("promptTitle")}
        />
        <p className="mt-1 text-xs text-navy/60">
          {systemPrompt.length} / {MAX_SYSTEM_PROMPT_CHARS}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={BUTTON_GHOST}
            onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
          >
            {t("promptReset")}
          </button>
          <button
            type="button"
            className={BUTTON_GHOST}
            onClick={() => setShowPreview((v) => !v)}
            aria-expanded={showPreview}
          >
            {showPreview ? t("promptHidePreview") : t("promptShowPreview")}
          </button>
        </div>
        <p className="mt-2 text-xs text-navy/60">{t("promptSafety")}</p>
        {showPreview ? (
          <pre
            className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-navy/10 bg-navy/5 p-3 text-xs text-navy"
            aria-label={t("promptPreviewLabel")}
          >
            {promptPreview}
          </pre>
        ) : null}
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("faqTitle")}
        </legend>
        <p className="mt-1 text-xs text-navy/60">{t("faqIntro")}</p>
        {faqs.map((row, i) => (
          <div
            key={i}
            className="mt-3 grid gap-3 border-t border-navy/10 pt-3 sm:grid-cols-2"
          >
            <label className="text-xs text-navy/70 sm:col-span-2">
              {t("faqQuestion")}
              <input
                value={row.question}
                onChange={(e) =>
                  setFaqs(
                    faqs.map((r, j) =>
                      j === i ? { ...r, question: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <label className="text-xs text-navy/70 sm:col-span-2">
              {t("faqKeywords")}
              <input
                value={row.keywords}
                onChange={(e) =>
                  setFaqs(
                    faqs.map((r, j) =>
                      j === i ? { ...r, keywords: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <label className="text-xs text-navy/70">
              {t("faqAnswerFr")}
              <textarea
                rows={2}
                maxLength={500}
                value={row.answerFr}
                onChange={(e) =>
                  setFaqs(
                    faqs.map((r, j) =>
                      j === i ? { ...r, answerFr: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <label className="text-xs text-navy/70">
              {t("faqAnswerEn")}
              <textarea
                rows={2}
                maxLength={500}
                value={row.answerEn}
                onChange={(e) =>
                  setFaqs(
                    faqs.map((r, j) =>
                      j === i ? { ...r, answerEn: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <button
              type="button"
              className={BUTTON_GHOST}
              onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}
            >
              {t("removeRow")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BUTTON_GHOST} mt-3`}
          disabled={faqs.length >= 20}
          onClick={() =>
            setFaqs([
              ...faqs,
              { question: "", keywords: "", answerFr: "", answerEn: "" },
            ])
          }
        >
          {t("addFaq")}
        </button>
      </fieldset>

      <fieldset className={CARD} disabled={dis || !canTransfer}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("routingTitle")}
        </legend>
        <p className="mt-1 text-xs text-navy/60">{t("routingIntro")}</p>
        {!canTransfer ? (
          <p className="mt-2 rounded-md border border-navy/15 bg-navy/5 px-3 py-2 text-xs text-navy/80">
            {t("plusOnlyTransfer")}
          </p>
        ) : null}
        {routing.map((row, i) => (
          <div
            key={i}
            className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end"
          >
            <label className="text-xs text-navy/70">
              {t("deptName")}
              <input
                value={row.name}
                maxLength={60}
                onChange={(e) =>
                  setRouting(
                    routing.map((r, j) =>
                      j === i ? { ...r, name: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <label className="text-xs text-navy/70">
              {t("deptPhone")}
              <input
                value={row.phoneE164}
                placeholder="+14385551234"
                onChange={(e) =>
                  setRouting(
                    routing.map((r, j) =>
                      j === i ? { ...r, phoneE164: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <label className="text-xs text-navy/70">
              {t("deptKeywords")}
              <input
                value={row.keywords}
                onChange={(e) =>
                  setRouting(
                    routing.map((r, j) =>
                      j === i ? { ...r, keywords: e.target.value } : r,
                    ),
                  )
                }
                className={INPUT}
              />
            </label>
            <button
              type="button"
              className={BUTTON_GHOST}
              onClick={() => setRouting(routing.filter((_, j) => j !== i))}
            >
              {t("removeRow")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BUTTON_GHOST} mt-3`}
          disabled={routing.length >= 8}
          onClick={() =>
            setRouting([...routing, { name: "", phoneE164: "", keywords: "" }])
          }
        >
          {t("addDept")}
        </button>
      </fieldset>

      <fieldset className={CARD} disabled={dis || (!canTransfer && !canEmergencyRoute)}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("transferTitle")}
        </legend>
        <p className="mt-1 text-xs text-navy/60">{t("transferIntro")}</p>
        {!canTransfer || !canEmergencyRoute ? (
          <p className="mt-2 rounded-md border border-navy/15 bg-navy/5 px-3 py-2 text-xs text-navy/80">
            {t("plusOnlyTransfer")}
          </p>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("primaryTransfer")}
            <input
              value={primaryTransfer}
              placeholder="+14385551234"
              onChange={(e) => setPrimaryTransfer(e.target.value)}
              className={INPUT}
              disabled={!canTransfer}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("secondaryTransfer")}
            <input
              value={secondaryTransfer}
              placeholder="+14385551234"
              onChange={(e) => setSecondaryTransfer(e.target.value)}
              className={INPUT}
              disabled={!canTransfer}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("emergencyPhone")}
            <input
              value={emergency}
              placeholder="+14385551234"
              onChange={(e) => setEmergency(e.target.value)}
              className={INPUT}
              disabled={!canEmergencyRoute}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("transferTimeout")}
            <input
              type="number"
              min={10}
              max={120}
              value={transferTimeout}
              onChange={(e) => setTransferTimeout(Number(e.target.value) || 30)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("failedTransfer")}
            <select
              className={INPUT}
              value={failedTransfer}
              onChange={(e) =>
                setFailedTransfer(
                  e.target
                    .value as ProfileSettings["transferSettings"]["failedAction"],
                )
              }
            >
              <option value="take_message">{t("failed.take_message")}</option>
              <option value="urgent_lead">{t("failed.urgent_lead")}</option>
              <option value="voicemail">{t("failed.voicemail")}</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-navy/70">{t("phoneHelp")}</p>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("appointmentTitle")}
        </legend>
        <p className="mt-1 text-xs text-navy/60">{t("appointmentIntro")}</p>
        {!canPhoneBook ? (
          <p className="mt-2 rounded-md border border-navy/15 bg-navy/5 px-3 py-2 text-xs text-navy/80">
            {t("plusOnlyBooking")}
          </p>
        ) : null}
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={phoneBooking && canPhoneBook}
            onChange={(e) => setPhoneBooking(e.target.checked)}
            aria-describedby="phone-booking-help"
            disabled={!canPhoneBook}
          />
          {t("phoneBooking")}
        </label>
        <p id="phone-booking-help" className="mt-1 text-xs text-navy/70">
          {t("phoneBookingHelp")}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("duration")}
            <input
              type="number"
              min={15}
              max={240}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 60)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("buffer")}
            <input
              type="number"
              min={0}
              max={120}
              value={buffer}
              onChange={(e) => setBuffer(Number(e.target.value) || 0)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("bookingNotice")}
            <input
              type="number"
              min={0}
              max={168}
              value={notice}
              onChange={(e) => setNotice(Number(e.target.value) || 0)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("maxDaily")}
            <input
              type="number"
              min={1}
              max={50}
              value={maxDaily}
              onChange={(e) => setMaxDaily(e.target.value)}
              className={INPUT}
              placeholder="—"
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("confirmationMethod")}
            <select
              className={INPUT}
              value={confirmMethod}
              onChange={(e) =>
                setConfirmMethod(
                  e.target
                    .value as ProfileSettings["appointmentSettings"]["confirmationMethod"],
                )
              }
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="both">{t("confirmBoth")}</option>
              <option value="none">{t("confirmNone")}</option>
            </select>
          </label>
          <label className="text-xs text-navy/70 sm:col-span-2">
            {t("bookableServices")}
            <input
              value={bookable}
              onChange={(e) => setBookable(e.target.value)}
              className={INPUT}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("notifyTitle")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("notifyEmail")}
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("notifySms")}
            <input
              value={notifySms}
              placeholder="+14385551234"
              onChange={(e) => setNotifySms(e.target.value)}
              className={INPUT}
            />
          </label>
        </div>
      </fieldset>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
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
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
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
