"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import type { OnboardingStepId } from "@/product/onboarding/types";

type StepRecord = {
  stepId: OnboardingStepId;
  status: string;
  required: boolean;
  lastError: string | null;
};

type Check = {
  checkId: string;
  required: boolean;
  passed: boolean;
  blocking: boolean;
  label: string;
  detail: string | null;
};

type Snapshot = {
  session: {
    status: string;
    currentStep: OnboardingStepId;
    plan: string;
    activatedAt: string | null;
    draft: Record<string, unknown>;
  };
  steps: StepRecord[];
  requirements: Array<{ stepId: OnboardingStepId; required: boolean; reason: string }>;
  readiness: {
    canActivate: boolean;
    blockingReasons: string[];
    checks: Check[];
    status: string;
  };
  canManage?: boolean;
};

const STEPS: OnboardingStepId[] = [
  "account",
  "business",
  "ai_receptionist",
  "phone",
  "calendar",
  "automations",
  "activation",
];

export function OnboardingWizard({
  organizationId,
  locale,
  plan,
  ownerName,
  ownerEmail,
  businessName,
}: {
  organizationId: string;
  locale: "en" | "fr";
  plan: string;
  ownerName: string;
  ownerEmail: string;
  businessName: string;
}) {
  const t = useTranslations("app.onboarding");
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<OnboardingStepId>("account");
  const [pending, startTransition] = useTransition();

  // Form state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(plan);
  const [bizName, setBizName] = useState(businessName);
  const [industry, setIndustry] = useState("plumbing");
  const [city, setCity] = useState("Montréal");
  const [serviceArea, setServiceArea] = useState("Montréal, Laval");
  const [services, setServices] = useState("Drain cleaning, pipe repair");
  const [hours, setHours] = useState("Monday–Friday, 8 AM–6 PM");
  const [timezone, setTimezone] = useState("America/Toronto");
  const [emergency, setEmergency] = useState(true);
  const [description, setDescription] = useState("");
  const [aiName, setAiName] = useState("Sophie");
  const [greeting, setGreeting] = useState(
    locale === "fr"
      ? "Merci d’appeler. Je suis Sophie, la réceptionniste virtuelle. Comment puis-je vous aider?"
      : "Thank you for calling. I’m Sophie, the virtual receptionist. How can I help you today?",
  );
  const [aiLanguage, setAiLanguage] = useState<"fr" | "en">("fr");
  const [existingPhone, setExistingPhone] = useState("");
  const [tradecatchNumber, setTradecatchNumber] = useState("");
  const [transferNumber, setTransferNumber] = useState("");
  const [forwardingAck, setForwardingAck] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState("forwarding");
  const [notifyEmail, setNotifyEmail] = useState(ownerEmail);
  const [enableMissedCall, setEnableMissedCall] = useState(true);

  async function load() {
    const res = await fetch(`/api/businesses/${organizationId}/onboarding`, {
      cache: "no-store",
    });
    const json = (await res.json()) as Snapshot & { error?: string };
    if (!res.ok) {
      setError(json.error || t("loadError"));
      return;
    }
    setData(json);
    setStep(json.session.currentStep);
    setError(null);
    const draft = json.session.draft || {};
    const biz = draft.business as Record<string, unknown> | undefined;
    if (biz?.businessName) setBizName(String(biz.businessName));
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  function saveStep(stepId: OnboardingStepId, payload: Record<string, unknown>, skip?: boolean) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/businesses/${organizationId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload, skip }),
      });
      const json = (await res.json()) as Snapshot & { error?: string };
      if (!res.ok) {
        setError(json.error || t("error"));
        if (json.session) setData(json as Snapshot);
        return;
      }
      setData(json);
      setStep(json.session.currentStep);
    });
  }

  function verify(path: string, body?: Record<string, unknown>) {
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/businesses/${organizationId}/onboarding/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        readiness?: Snapshot["readiness"];
      };
      if (!res.ok || !json.ok) {
        setError(json.error || t("verifyFailed"));
      }
      await load();
    });
  }

  function activate() {
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/businesses/${organizationId}/onboarding/activate`,
        { method: "POST" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("activateBlocked"));
        await load();
        return;
      }
      await load();
    });
  }

  const stepIndex = STEPS.indexOf(step);
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  const reqMap = new Map(
    (data?.requirements ?? []).map((r) => [r.stepId, r]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="border-t border-navy/15 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/50">
          {t("setup")} · {t("stepOf", { current: stepIndex + 1, total: STEPS.length })} ·{" "}
          {progress}%
        </p>
        <div className="mt-3 h-1.5 w-full bg-navy/10">
          <div
            className="h-1.5 bg-orange transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <ol className="mt-4 flex flex-wrap gap-2">
          {STEPS.map((id, i) => {
            const rec = data?.steps.find((s) => s.stepId === id);
            const required = reqMap.get(id)?.required ?? true;
            const done =
              rec?.status === "completed" ||
              rec?.status === "verified" ||
              rec?.status === "skipped";
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setStep(id)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    step === id
                      ? "bg-navy text-white"
                      : done
                        ? "bg-navy/10 text-navy"
                        : "text-navy/55 hover:bg-navy/5"
                  }`}
                >
                  {i + 1}. {t(`steps.${id}`)}
                  {!required ? ` (${t("optional")})` : ""}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      ) : null}

      {data?.session.activatedAt ? (
        <p className="text-sm text-navy/70">
          {t("alreadyActive")}{" "}
          <Link href="/app" className="text-orange underline-offset-2 hover:underline">
            {t("goDashboard")}
          </Link>
        </p>
      ) : null}

      {step === "account" ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-navy">{t("accountTitle")}</h2>
          <p className="text-sm text-navy/65">{t("accountIntro")}</p>
          <p className="text-sm text-navy">
            {ownerName} · {ownerEmail}
          </p>
          <label className="block text-sm text-navy/70">
            {t("plan")}
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="mt-1 w-full max-w-md rounded-md border border-navy/20 px-3 py-2 text-navy"
            >
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="ai_receptionist">AI Receptionist</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm text-navy/70">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-1"
            />
            {t("terms")}
          </label>
          <button
            type="button"
            disabled={pending || !termsAccepted}
            onClick={() =>
              saveStep("account", {
                plan: selectedPlan,
                termsAccepted,
                fullName: ownerName,
                email: ownerEmail,
              })
            }
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? t("saving") : t("next")}
          </button>
        </section>
      ) : null}

      {step === "business" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy">{t("businessTitle")}</h2>
          <p className="text-sm text-navy/65">{t("businessIntro")}</p>
          {(
            [
              [t("fields.businessName"), bizName, setBizName],
              [t("fields.industry"), industry, setIndustry],
              [t("fields.city"), city, setCity],
              [t("fields.serviceAreas"), serviceArea, setServiceArea],
              [t("fields.services"), services, setServices],
              [t("fields.hours"), hours, setHours],
              [t("fields.timezone"), timezone, setTimezone],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label} className="block text-sm text-navy/70">
              {label}
              <input
                value={value}
                onChange={(e) => setter(e.target.value)}
                className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-navy"
              />
            </label>
          ))}
          <label className="block text-sm text-navy/70">
            {t("fields.description")}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-navy"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-navy/70">
            <input
              type="checkbox"
              checked={emergency}
              onChange={(e) => setEmergency(e.target.checked)}
            />
            {t("fields.emergency")}
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setStep("account")}
              className="rounded-md border border-navy/20 px-4 py-2 text-sm"
            >
              {t("previous")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                saveStep("business", {
                  businessName: bizName,
                  industry,
                  city,
                  serviceArea,
                  serviceAreas: serviceArea.split(",").map((s) => s.trim()),
                  services: services.split(",").map((s) => s.trim()),
                  businessHours: hours,
                  timezone,
                  emergencyService: emergency,
                  description,
                  language: locale,
                })
              }
              className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? t("saving") : t("next")}
            </button>
          </div>
        </section>
      ) : null}

      {step === "ai_receptionist" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy">{t("aiTitle")}</h2>
          <p className="text-sm text-navy/65">{t("aiIntro")}</p>
          {!reqMap.get("ai_receptionist")?.required ? (
            <p className="text-sm text-navy/60">{t("aiUpgrade")}</p>
          ) : null}
          <label className="block text-sm text-navy/70">
            {t("fields.aiName")}
            <input
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-navy/70">
            {t("fields.greeting")}
            <textarea
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-navy/70">
            {t("fields.language")}
            <select
              value={aiLanguage}
              onChange={(e) => setAiLanguage(e.target.value as "fr" | "en")}
              className="mt-1 rounded-md border border-navy/20 px-3 py-2"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep("business")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("previous")}
            </button>
            {!reqMap.get("ai_receptionist")?.required ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => saveStep("ai_receptionist", {}, true)}
                className="rounded-md border border-navy/20 px-4 py-2 text-sm"
              >
                {t("skip")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending || !reqMap.get("ai_receptionist")?.required}
              onClick={() =>
                saveStep("ai_receptionist", {
                  aiName,
                  welcomeGreeting: greeting,
                  language: aiLanguage,
                  personality: "professional, friendly, concise",
                })
              }
              className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? t("saving") : t("next")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => verify("verify-ai")}
              className="rounded-md border border-navy/20 px-4 py-2 text-sm"
            >
              {t("verifyAi")}
            </button>
          </div>
        </section>
      ) : null}

      {step === "phone" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy">{t("phoneTitle")}</h2>
          <p className="text-sm text-navy/65">{t("phoneIntro")}</p>
          <p className="text-xs text-navy/50">{t("phoneForwardingNote")}</p>
          <label className="block text-sm text-navy/70">
            {t("fields.connectionMethod")}
            <select
              value={connectionMethod}
              onChange={(e) => setConnectionMethod(e.target.value)}
              className="mt-1 w-full max-w-md rounded-md border border-navy/20 px-3 py-2"
            >
              <option value="new_number">{t("connection.new")}</option>
              <option value="forwarding">{t("connection.forwarding")}</option>
              <option value="porting">{t("connection.porting")}</option>
            </select>
          </label>
          <label className="block text-sm text-navy/70">
            {t("fields.existingPhone")}
            <input
              value={existingPhone}
              onChange={(e) => setExistingPhone(e.target.value)}
              placeholder="+15145550100"
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-navy/70">
            {t("fields.tradecatchNumber")}
            <input
              value={tradecatchNumber}
              onChange={(e) => setTradecatchNumber(e.target.value)}
              placeholder="+15145550199"
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-navy/70">
            {t("fields.transferNumber")}
            <input
              value={transferNumber}
              onChange={(e) => setTransferNumber(e.target.value)}
              placeholder="+15145550123"
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-navy/70">
            <input
              type="checkbox"
              checked={forwardingAck}
              onChange={(e) => setForwardingAck(e.target.checked)}
              className="mt-1"
            />
            {t("fields.forwardingAck")}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep("ai_receptionist")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("previous")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                saveStep("phone", {
                  existingBusinessNumber: existingPhone || undefined,
                  tradecatchNumber: tradecatchNumber || undefined,
                  humanTransferNumber: transferNumber || undefined,
                  forwardingInstructionsAck: forwardingAck,
                  connectionMethod,
                  callRouting: "ai_first",
                })
              }
              className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? t("saving") : t("next")}
            </button>
            <button type="button" disabled={pending} onClick={() => verify("verify-phone")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("verifyPhone")}
            </button>
            <button type="button" disabled={pending} onClick={() => verify("test-call", { mode: "simulation" })} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("testCallSim")}
            </button>
            <button type="button" disabled={pending} onClick={() => verify("test-call", { mode: "confirm_live" })} className="rounded-md border border-orange/40 px-4 py-2 text-sm text-orange">
              {t("confirmLiveCall")}
            </button>
          </div>
        </section>
      ) : null}

      {step === "calendar" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy">{t("calendarTitle")}</h2>
          <p className="text-sm text-navy/65">{t("calendarIntro")}</p>
          <p className="text-sm text-navy/55">{t("calendarWithout")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep("phone")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("previous")}
            </button>
            <a
              href={`/api/businesses/${organizationId}/calendar/connect`}
              className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white"
            >
              {t("connectCalendar")}
            </a>
            <button
              type="button"
              disabled={pending}
              onClick={() => saveStep("calendar", { connectGoogle: false }, true)}
              className="rounded-md border border-navy/20 px-4 py-2 text-sm"
            >
              {t("skip")}
            </button>
            <button type="button" disabled={pending} onClick={() => verify("verify-calendar")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("verifyCalendar")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => saveStep("calendar", { connectGoogle: true, bookingEnabled: true })}
              className="rounded-md border border-navy/20 px-4 py-2 text-sm"
            >
              {t("next")}
            </button>
          </div>
        </section>
      ) : null}

      {step === "automations" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy">{t("automationsTitle")}</h2>
          <p className="text-sm text-navy/65">{t("automationsIntro")}</p>
          <label className="block text-sm text-navy/70">
            {t("fields.notifyEmail")}
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-navy/70">
            <input
              type="checkbox"
              checked={enableMissedCall}
              onChange={(e) => setEnableMissedCall(e.target.checked)}
            />
            {t("fields.enableMissedCall")}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep("calendar")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("previous")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                saveStep("automations", {
                  notifyEmail,
                  enableMissedCall,
                })
              }
              className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? t("saving") : t("next")}
            </button>
            <button type="button" disabled={pending} onClick={() => verify("verify-messaging")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("verifyMessaging")}
            </button>
          </div>
        </section>
      ) : null}

      {step === "activation" ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-navy">{t("activationTitle")}</h2>
          <p className="text-sm text-navy/65">{t("activationIntro")}</p>
          <ul className="divide-y divide-navy/10">
            {(data?.readiness.checks ?? []).map((c) => (
              <li key={c.checkId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium text-navy">
                    {c.label}
                    {c.required ? "" : ` · ${t("optional")}`}
                  </p>
                  <p className="text-navy/60">{c.detail}</p>
                </div>
                <span
                  className={
                    c.passed
                      ? "font-semibold text-navy"
                      : c.blocking
                        ? "font-semibold text-orange"
                        : "text-navy/50"
                  }
                >
                  {c.passed
                    ? t("statusVerified")
                    : c.blocking
                      ? t("statusBlocked")
                      : t("statusPending")}
                </span>
              </li>
            ))}
          </ul>
          {data?.readiness.blockingReasons?.length ? (
            <p className="text-sm text-orange">
              {t("activationBlocked")}: {data.readiness.blockingReasons.join(" · ")}
            </p>
          ) : (
            <p className="text-sm text-navy/70">{t("activationReady")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep("automations")} className="rounded-md border border-navy/20 px-4 py-2 text-sm">
              {t("previous")}
            </button>
            <button
              type="button"
              disabled={pending || !data?.readiness.canActivate}
              onClick={() => activate()}
              className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? t("saving") : t("activate")}
            </button>
            <Link href="/app" className="rounded-md border border-navy/20 px-4 py-2 text-sm text-navy">
              {t("goDashboard")}
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
