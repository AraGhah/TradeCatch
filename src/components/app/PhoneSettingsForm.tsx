"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PhoneSettingsView } from "@/product/telephony/types";

const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy disabled:bg-navy/5";
const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

export function PhoneSettingsForm({
  organizationId,
  initial,
  readOnly,
}: {
  organizationId: string;
  initial: PhoneSettingsView;
  readOnly: boolean;
}) {
  const t = useTranslations("app.phoneSettings");
  const router = useRouter();
  const [businessPhone, setBusinessPhone] = useState(
    initial.businessPhoneE164 ?? "",
  );
  const [tradecatchNumber, setTradecatchNumber] = useState(
    initial.tradecatchNumberE164 ?? "",
  );
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [strategy, setStrategy] = useState(initial.inboundStrategy);
  const [voiceEngine, setVoiceEngine] = useState(initial.voiceEngine);
  const [human, setHuman] = useState(initial.humanTransferE164 ?? "");
  const [backup, setBackup] = useState(initial.backupTransferE164 ?? "");
  const [timeout, setTimeoutSec] = useState(initial.humanRingTimeoutSeconds);
  const [recording, setRecording] = useState(initial.callRecordingEnabled);
  const [forwardAck, setForwardAck] = useState(
    initial.forwardingInstructionsAck,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/phone-settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessPhoneE164: businessPhone,
            tradecatchNumberE164: tradecatchNumber,
            aiEnabled,
            inboundStrategy: strategy,
            voiceEngine,
            humanTransferE164: human,
            backupTransferE164: backup,
            humanRingTimeoutSeconds: timeout,
            callRecordingEnabled: recording,
            forwardingInstructionsAck: forwardAck,
            ringHumanOnOverflow: true,
            connectionStatus: tradecatchNumber ? "connected" : "disconnected",
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || t("error"));
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
  const statusClass =
    initial.connectionStatus === "connected"
      ? "border-green-300 bg-green-50 text-green-900"
      : initial.connectionStatus === "error"
        ? "border-red-300 bg-red-50 text-red-900"
        : "border-navy/15 bg-white text-navy/80";

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
      <div className={`rounded-md border px-4 py-3 text-sm ${statusClass}`}>
        <p className="font-semibold">
          {t(`status.${initial.connectionStatus}`)}
        </p>
        {initial.connectionDetail ? (
          <p className="mt-1 text-xs opacity-90">{initial.connectionDetail}</p>
        ) : null}
        {initial.webhookVoiceUrl ? (
          <p className="mt-2 break-all font-mono text-[11px] opacity-80">
            {t("webhook")}: {initial.webhookVoiceUrl}
          </p>
        ) : null}
      </div>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("numbersTitle")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("businessPhone")}
            <input
              value={businessPhone}
              onChange={(e) => setBusinessPhone(e.target.value)}
              className={INPUT}
              placeholder="+15145550100"
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("tradecatchNumber")}
            <input
              value={tradecatchNumber}
              onChange={(e) => setTradecatchNumber(e.target.value)}
              className={INPUT}
              placeholder="+14385597001"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-navy/60">{t("forwardingHelp")}</p>
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={forwardAck}
            onChange={(e) => setForwardAck(e.target.checked)}
          />
          {t("forwardingAck")}
        </label>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("routingTitle")}
        </legend>
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
          />
          {t("aiEnabled")}
        </label>
        <label className="mt-3 block text-xs text-navy/70">
          {t("inboundStrategy")}
          <select
            className={INPUT}
            value={strategy}
            onChange={(e) =>
              setStrategy(
                e.target.value === "human_first" ? "human_first" : "ai_first",
              )
            }
          >
            <option value="ai_first">{t("strategy.ai_first")}</option>
            <option value="human_first">{t("strategy.human_first")}</option>
          </select>
        </label>
        <label className="mt-3 block text-xs text-navy/70">
          {t("voiceEngine")}
          <select
            className={INPUT}
            value={voiceEngine}
            onChange={(e) =>
              setVoiceEngine(
                e.target.value === "conversation_relay"
                  ? "conversation_relay"
                  : "gather",
              )
            }
          >
            <option value="gather">{t("engine.gather")}</option>
            <option value="conversation_relay">
              {t("engine.conversation_relay")}
            </option>
          </select>
        </label>
        <p className="mt-1 text-xs text-navy/50">{t("engineHelp")}</p>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("transferTitle")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-navy/70">
            {t("humanTransfer")}
            <input
              value={human}
              onChange={(e) => setHuman(e.target.value)}
              className={INPUT}
              placeholder="+14385551234"
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("backupTransfer")}
            <input
              value={backup}
              onChange={(e) => setBackup(e.target.value)}
              className={INPUT}
              placeholder="+14385551235"
            />
          </label>
          <label className="text-xs text-navy/70">
            {t("ringTimeout")}
            <input
              type="number"
              min={10}
              max={60}
              value={timeout}
              onChange={(e) => setTimeoutSec(Number(e.target.value) || 25)}
              className={INPUT}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={CARD} disabled={dis}>
        <legend className="px-1 text-sm font-semibold text-navy">
          {t("recordingTitle")}
        </legend>
        <label className="mt-3 flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={recording}
            onChange={(e) => setRecording(e.target.checked)}
          />
          {t("recordingEnabled")}
        </label>
        <p className="mt-1 text-xs text-navy/60">{t("recordingHelp")}</p>
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

      <button type="submit" disabled={dis} className={BUTTON}>
        {busy ? t("saving") : t("save")}
      </button>
    </form>
  );
}
