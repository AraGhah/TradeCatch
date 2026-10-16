"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Rule = {
  enabled: boolean;
  primaryUserId?: string;
  secondaryUserId?: string;
  secondaryPhoneE164?: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  acknowledgementRequired: boolean;
  delayMinutes: number;
  maxAttempts: number;
  afterHours: boolean;
};

export function EscalationRulesForm({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.alerts");
  const [rule, setRule] = useState<Rule | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/businesses/${organizationId}/escalation-rules`)
      .then((res) => res.json())
      .then((data) => setRule((data as { rule?: Rule }).rule ?? null));
  }, [organizationId]);

  if (!rule) return null;

  return (
    <form
      className="grid max-w-lg gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void fetch(`/api/businesses/${organizationId}/escalation-rules`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        }).then((res) => setMessage(res.ok ? t("saved") : t("error")));
      }}
    >
      <label className="text-sm"><input type="checkbox" checked={rule.enabled} onChange={(event) => setRule({ ...rule, enabled: event.target.checked })} /> {t("enabled")}</label>
      <label className="text-sm">{t("primary")}
        <input value={rule.primaryUserId ?? ""} onChange={(event) => setRule({ ...rule, primaryUserId: event.target.value || undefined })} className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      <label className="text-sm">{t("backup")}
        <input value={rule.secondaryUserId ?? ""} onChange={(event) => setRule({ ...rule, secondaryUserId: event.target.value || undefined })} className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      <label className="text-sm">{t("delay")}
        <input type="number" value={rule.delayMinutes} onChange={(event) => setRule({ ...rule, delayMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      <label className="text-sm">{t("attempts")}
        <input type="number" value={rule.maxAttempts} onChange={(event) => setRule({ ...rule, maxAttempts: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      <label className="text-sm"><input type="checkbox" checked={rule.acknowledgementRequired} onChange={(event) => setRule({ ...rule, acknowledgementRequired: event.target.checked })} /> {t("ackRequired")}</label>
      <label className="text-sm"><input type="checkbox" checked={rule.afterHours} onChange={(event) => setRule({ ...rule, afterHours: event.target.checked })} /> {t("afterHours")}</label>
      <label className="text-sm"><input type="checkbox" checked={rule.emailEnabled} onChange={(event) => setRule({ ...rule, emailEnabled: event.target.checked })} /> {t("email")}</label>
      <label className="text-sm"><input type="checkbox" checked={rule.smsEnabled} onChange={(event) => setRule({ ...rule, smsEnabled: event.target.checked })} /> {t("sms")}</label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">{t("save")}</button>
      {message ? <p className="text-sm">{message}</p> : null}
    </form>
  );
}
