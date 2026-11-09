"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { AiCallHandlingView } from "@/product/telephony/ai-call-handling-service";
import type {
  AiCallMode,
  CallRoutingMethod,
  PersonalCallPolicy,
  UnknownCallerPolicy,
} from "@/product/telephony/types";

const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy disabled:bg-navy/5";
const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const SECONDARY =
  "rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50";

type Contact = { e164: string; label: string };

type TestState =
  | { status: "not_started" | "expired" | "waiting" | "verified" }
  | { status: "other_path"; path: string };

/** "+15145550142" → "514 555-0142" for reading; the stored value stays E.164. */
function pretty(e164: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `${m[1]} ${m[2]}-${m[3]}` : (e164 ?? "");
}

/** Dial code with the TradeCatch number's 10 digits. */
function code(prefix: string, number: string | null) {
  const digits = (number ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return `${prefix}${digits || "XXXXXXXXXX"}#`;
}

export function AiCallHandlingSection({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: AiCallHandlingView;
}) {
  const t = useTranslations("app.aiCallHandling");
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<AiCallMode>(initial.requestedMode);
  const [method, setMethod] = useState<CallRoutingMethod>(initial.routingMethod);
  const [contractor, setContractor] = useState(initial.contractorPhoneE164 ?? "");
  const [businessPhone, setBusinessPhone] = useState(initial.businessPhoneE164 ?? "");
  const [ringTimeout, setRingTimeout] = useState(Math.min(initial.ringTimeoutSeconds, 40));
  const [contacts, setContacts] = useState<Contact[]>(
    (initial.personalContacts ?? []).map((c) => ({ e164: c.e164, label: c.label ?? "" })),
  );
  // Call transfer is not offered, so a saved "transfer" policy is shown as taking a message.
  const [policy, setPolicy] = useState<PersonalCallPolicy>(
    initial.personalCallPolicy === "transfer" ? "message" : initial.personalCallPolicy,
  );
  const [messageFr, setMessageFr] = useState(initial.personalCallMessage.fr);
  const [messageEn, setMessageEn] = useState(initial.personalCallMessage.en);
  const [unknownPolicy, setUnknownPolicy] = useState<UnknownCallerPolicy>(
    initial.unknownCallerPolicy,
  );
  const [busy, setBusy] = useState<null | "save" | "test" | "check" | "number">(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [test, setTest] = useState<TestState | null>(
    initial.routingTestStartedAt ? { status: "waiting" } : null,
  );

  const readOnly = !view.canEdit;
  const noVoice = view.status === "unsupported_plan";
  const disabled = readOnly || noVoice || busy !== null;
  const active = view.status === "verified";

  async function call(
    methodName: "PUT" | "POST",
    body: unknown,
  ): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
    const res = await fetch(`/api/businesses/${organizationId}/ai-call-handling`, {
      method: methodName,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, data };
  }

  function errorText(data: Record<string, unknown> | null): string {
    const codeValue = typeof data?.code === "string" ? data.code : "";
    if (codeValue === "plan_upgrade_required") return t("errors.plan");
    if (codeValue === "forbidden") return t("errors.forbidden");
    if (codeValue === "client_not_linked") return t("errors.notLinked");
    if (codeValue === "invalid") return t("errors.invalid");
    return t("errors.generic");
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setSaved(false);
    setError(null);
    setFieldErrors([]);
    try {
      const { ok, data } = await call("PUT", {
        aiCallMode: mode,
        routingMethod: method,
        contractorPhoneE164: contractor,
        businessPhoneE164: businessPhone,
        ringTimeoutSeconds: ringTimeout,
        personalContacts: contacts
          .filter((c) => c.e164.trim())
          .map((c) => ({ e164: c.e164, label: c.label || undefined })),
        personalCallPolicy: policy,
        personalCallMessage: { fr: messageFr, en: messageEn },
        personalCallTransferE164: "",
        unknownCallerPolicy: unknownPolicy,
      });
      if (!ok || !data) {
        setError(errorText(data));
        const issues = Array.isArray(data?.issues) ? (data.issues as { field: string }[]) : [];
        setFieldErrors(issues.map((i) => i.field));
        return;
      }
      setView(data.aiCallHandling as AiCallHandlingView);
      if (data.routingChanged) setTest(null);
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function onAction(action: "start_test" | "check_test" | "check_number") {
    setBusy(action === "start_test" ? "test" : action === "check_test" ? "check" : "number");
    setError(null);
    try {
      const { ok, data } = await call("POST", { action });
      if (!ok || !data) {
        setError(errorText(data));
        return;
      }
      setView(data.aiCallHandling as AiCallHandlingView);
      if (action === "start_test") setTest({ status: "waiting" });
      if (action === "check_test" && data.test) setTest(data.test as TestState);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  const statusTone = active
    ? "border-green-300 bg-green-50 text-green-900"
    : view.status === "setup_required" || view.status === "unsupported_plan"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-navy/15 bg-white text-navy/80";
  const hasError = (field: string) => fieldErrors.some((f) => f.startsWith(field));
  const tc = view.tradecatchNumberE164;

  return (
    <section aria-labelledby="ai-call-handling-title" className="flex flex-col gap-5">
      <header>
        <h2
          id="ai-call-handling-title"
          className="font-[family-name:var(--font-archivo)] text-xl font-extrabold text-navy"
        >
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-navy/70">{t("intro")}</p>
      </header>

      <div role="status" className={`rounded-md border px-4 py-3 text-sm ${statusTone}`}>
        <p className="font-semibold">
          {active
            ? t("state.active", { mode: t(`modes.${view.requestedMode}.name`) })
            : t("state.requested", { mode: t(`modes.${view.requestedMode}.name`) })}
        </p>
        <p className="mt-1">{t(`status.${view.status}`)}</p>
        {view.effectiveMode !== view.requestedMode ? (
          <p className="mt-1">{t(`effective.${view.effectiveMode}`)}</p>
        ) : null}
        {view.modeSource === "legacy" ? (
          <p className="mt-1 text-xs opacity-90">{t("legacyNote")}</p>
        ) : null}
        {[...view.issues, ...view.warnings].length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {[...view.issues, ...view.warnings].map((issue) => (
              <li key={issue}>{t(`issues.${issue}`)}</li>
            ))}
          </ul>
        ) : null}
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          <div>
            <dt className="inline font-semibold">{t("numbers.tradecatch")}: </dt>
            <dd className="inline">{tc ? pretty(tc) : t("numbers.none")}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">{t("numbers.contractor")}: </dt>
            <dd className="inline">
              {view.contractorPhoneE164 ? pretty(view.contractorPhoneE164) : t("numbers.none")}
            </dd>
          </div>
        </dl>
      </div>

      <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-5">
        <fieldset className={CARD} disabled={disabled}>
          <legend className="px-1 text-sm font-semibold text-navy">{t("modeLegend")}</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["missed_calls_only", "ai_answers_all"] as const).map((m) => (
              <label
                key={m}
                className={`flex cursor-pointer gap-3 rounded-md border px-3 py-3 text-sm ${
                  mode === m ? "border-navy bg-navy/5" : "border-navy/15"
                }`}
              >
                <input
                  type="radio"
                  name="aiCallMode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-navy">
                    {t(`modes.${m}.name`)}
                    {m === "missed_calls_only" ? (
                      <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-900">
                        {t("recommended")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-navy/70">{t(`modes.${m}.description`)}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-navy/60">{t("switchBack")}</p>
        </fieldset>

        <fieldset className={CARD} disabled={disabled}>
          <legend className="px-1 text-sm font-semibold text-navy">{t("routingLegend")}</legend>
          <div className="mt-3 flex flex-col gap-2">
            {(["tradecatch_number", "carrier_forwarding"] as const).map((r) => (
              <label key={r} className="flex gap-2 text-sm text-navy">
                <input
                  type="radio"
                  name="routingMethod"
                  value={r}
                  checked={method === r}
                  onChange={() => setMethod(r)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">{t(`routing.${r}.name`)}</span>
                  <span className="block text-xs text-navy/60">{t(`routing.${r}.description`)}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {method === "tradecatch_number" ? (
              <label className="text-xs text-navy/70">
                {t("fields.contractorPhone")}
                <input
                  value={contractor}
                  onChange={(e) => setContractor(e.target.value)}
                  className={INPUT}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="514 555-0142"
                  aria-invalid={hasError("contractorPhoneE164")}
                />
                <span className="mt-1 block text-navy/50">{t("fields.contractorPhoneHelp")}</span>
              </label>
            ) : (
              <label className="text-xs text-navy/70">
                {t("fields.businessPhone")}
                <input
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  className={INPUT}
                  inputMode="tel"
                  placeholder="514 555-0100"
                  aria-invalid={hasError("businessPhoneE164")}
                />
                <span className="mt-1 block text-navy/50">{t("fields.businessPhoneHelp")}</span>
              </label>
            )}
            {method === "tradecatch_number" && mode === "missed_calls_only" ? (
              <label className="text-xs text-navy/70">
                {t("fields.ringTimeout")}
                <input
                  type="number"
                  min={10}
                  max={40}
                  value={ringTimeout}
                  onChange={(e) => setRingTimeout(Number(e.target.value) || 20)}
                  className={INPUT}
                />
                <span className="mt-1 block text-navy/50">{t("fields.ringTimeoutHelp")}</span>
              </label>
            ) : null}
          </div>

          {method === "carrier_forwarding" ? (
            <div className="mt-4 rounded-md bg-navy/5 px-3 py-3 text-xs text-navy/80">
              <p className="font-semibold text-navy">{t("forwarding.title")}</p>
              <p className="mt-1">{t("forwarding.honest")}</p>
              {mode === "missed_calls_only" ? (
                <ul className="mt-2 flex flex-col gap-1 font-mono">
                  <li>{t("forwarding.noAnswer")}: {code("**61*", tc)}</li>
                  <li>{t("forwarding.busy")}: {code("**67*", tc)}</li>
                  <li>{t("forwarding.unreachable")}: {code("**62*", tc)}</li>
                </ul>
              ) : (
                <ul className="mt-2 flex flex-col gap-1 font-mono">
                  <li>{t("forwarding.all")}: {code("**21*", tc)}</li>
                </ul>
              )}
              <p className="mt-2 font-mono">{t("forwarding.cancel")}: ##002#</p>
              <p className="mt-2">{t("forwarding.carriersVary")}</p>
            </div>
          ) : null}
        </fieldset>

        <fieldset className={CARD} disabled={disabled}>
          <legend className="px-1 text-sm font-semibold text-navy">{t("contacts.legend")}</legend>
          <p className="mt-2 text-xs text-navy/60">{t("contacts.help")}</p>
          {view.personalContacts === null ? (
            <p className="mt-3 text-sm text-navy/70">
              {t("contacts.countOnly", { count: view.personalContactCount })}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {contacts.map((c, i) => (
                <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 text-xs text-navy/70">
                    {t("contacts.number")}
                    <input
                      value={c.e164}
                      onChange={(e) =>
                        setContacts(contacts.map((x, j) => (j === i ? { ...x, e164: e.target.value } : x)))
                      }
                      className={INPUT}
                      inputMode="tel"
                      aria-invalid={hasError(`personalContacts.${i}`)}
                    />
                  </label>
                  <label className="flex-1 text-xs text-navy/70">
                    {t("contacts.label")}
                    <input
                      value={c.label}
                      maxLength={60}
                      onChange={(e) =>
                        setContacts(contacts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                      }
                      className={INPUT}
                    />
                  </label>
                  <button
                    type="button"
                    className={SECONDARY}
                    onClick={() => setContacts(contacts.filter((_, j) => j !== i))}
                  >
                    {t("contacts.remove")}
                  </button>
                </div>
              ))}
              {contacts.length < 50 ? (
                <button
                  type="button"
                  className={`${SECONDARY} self-start`}
                  onClick={() => setContacts([...contacts, { e164: "", label: "" }])}
                >
                  {t("contacts.add")}
                </button>
              ) : null}
            </div>
          )}

          <label className="mt-4 block text-xs text-navy/70">
            {t("contacts.policy")}
            <select
              className={INPUT}
              value={policy}
              onChange={(e) => setPolicy(e.target.value as PersonalCallPolicy)}
            >
              <option value="message">{t("contacts.policies.message")}</option>
              <option value="end">{t("contacts.policies.end")}</option>
            </select>
          </label>
          {policy === "message" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-navy/70">
                {t("contacts.messageFr")}
                <textarea
                  value={messageFr}
                  maxLength={300}
                  rows={2}
                  onChange={(e) => setMessageFr(e.target.value)}
                  className={INPUT}
                  placeholder={t("contacts.messagePlaceholder")}
                />
              </label>
              <label className="text-xs text-navy/70">
                {t("contacts.messageEn")}
                <textarea
                  value={messageEn}
                  maxLength={300}
                  rows={2}
                  onChange={(e) => setMessageEn(e.target.value)}
                  className={INPUT}
                  placeholder={t("contacts.messagePlaceholder")}
                />
              </label>
            </div>
          ) : null}
          <label className="mt-4 block text-xs text-navy/70">
            {t("contacts.unknownPolicy")}
            <select
              className={INPUT}
              value={unknownPolicy}
              onChange={(e) => setUnknownPolicy(e.target.value === "message" ? "message" : "ai")}
            >
              <option value="ai">{t("contacts.unknownPolicies.ai")}</option>
              <option value="message">{t("contacts.unknownPolicies.message")}</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-navy/50">{t("contacts.spoofNote")}</p>
        </fieldset>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-800">
            {t("saved")}
          </p>
        ) : null}
        {readOnly ? <p className="text-xs text-navy/60">{t("readOnly")}</p> : null}

        <button type="submit" disabled={disabled} className={`${BUTTON} self-start`}>
          {busy === "save" ? t("saving") : t("save")}
        </button>
      </form>

      <div className={CARD}>
        <p className="text-sm font-semibold text-navy">{t("test.title")}</p>
        <p className="mt-1 text-xs text-navy/70">
          {t(`test.how.${method === "carrier_forwarding" ? "forwarding" : mode}`)}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className={SECONDARY}
            disabled={disabled}
            onClick={() => void onAction("start_test")}
          >
            {busy === "test" ? t("test.starting") : t("test.start")}
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={disabled || !view.routingTestStartedAt}
            onClick={() => void onAction("check_test")}
          >
            {busy === "check" ? t("test.checking") : t("test.check")}
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={disabled || !tc}
            onClick={() => void onAction("check_number")}
          >
            {busy === "number" ? t("test.checking") : t("test.number")}
          </button>
        </div>
        {test ? (
          <p role="status" className="mt-3 text-sm text-navy">
            {test.status === "other_path"
              ? t("test.result.other_path", { path: t(`paths.${test.path}`) })
              : t(`test.result.${test.status}`)}
          </p>
        ) : null}
        {view.numberRoutingCheckedAt ? (
          <p className="mt-2 text-xs text-navy/60">
            {t(`numberRouting.${view.numberRouting}`)}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-navy/50">{t("test.noRealCalls")}</p>
      </div>
    </section>
  );
}
