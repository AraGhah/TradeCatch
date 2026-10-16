"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Alert = { id: string; component: string; severity: string; message: string; correlationId: string; createdAt: string };

export function AdminSystemAlerts() {
  const t = useTranslations("app.alerts");
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    void fetch("/api/admin/system-alerts")
      .then((res) => (res.ok ? res.json() : { alerts: [] }))
      .then((data) => setAlerts((data as { alerts?: Alert[] }).alerts ?? []));
  }, []);

  return (
    <section className="rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{t("adminTitle")}</h2>
      {alerts.length === 0 ? <p className="mt-2 text-sm text-navy/60">{t("adminEmpty")}</p> : (
        <ul className="mt-3 divide-y divide-navy/10 text-sm">
          {alerts.map((alert) => (
            <li key={alert.id} className="py-2">
              <span className="font-semibold">{alert.severity}</span> · {alert.component} · {alert.message}
              <span className="mt-1 block text-xs text-navy/50">{alert.correlationId} · {new Date(alert.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
