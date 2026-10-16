"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Slot = { startAt: string; localLabel: string };

export function AppointmentTestPanel({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.schedule");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [output, setOutput] = useState("");

  useEffect(() => {
    void fetch(`/api/businesses/${organizationId}/service-types`)
      .then((res) => res.json())
      .then((data) => {
        const services = (data as { services?: { id: string; name: string }[] }).services ?? [];
        setServices(services);
        setServiceId(services[0]?.id ?? "");
      });
  }, [organizationId]);

  async function post(action: string, extra?: Record<string, string>) {
    const res = await fetch(`/api/businesses/${organizationId}/appointments/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, serviceId, ...extra }),
    });
    const data = (await res.json()) as { slots?: Slot[]; confirmed?: boolean };
    if (action === "availability" && Array.isArray(data.slots)) setSlots(data.slots);
    setOutput(JSON.stringify(data, null, 2));
    return data as { slots?: Slot[]; appointment?: { id: string }; confirmed?: boolean };
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{t("testTitle")}</h2>
      <p className="text-sm text-navy/70">{t("testIntro")}</p>
      <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="max-w-sm rounded-md border border-navy/15 px-2 py-1.5 text-sm">
        {services.map((service) => (
          <option key={service.id} value={service.id}>{service.name}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white" onClick={() => void post("availability")}>{t("check")}</button>
        <button
          type="button"
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold"
          onClick={() => void post("book", { startAt: slots[0]?.startAt ?? "", customerName: "Test Customer A", customerPhoneE164: "+15145550100" })}
        >
          {t("simulate")}
        </button>
        <button
          type="button"
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold"
          onClick={() => {
            const startAt = slots[0]?.startAt ?? "";
            void Promise.all([
              post("book", { startAt, customerName: "Test Customer A" }),
              post("book", { startAt, customerName: "Test Customer B" }),
            ]).then((results) => setOutput(JSON.stringify(results, null, 2)));
          }}
        >
          {t("double")}
        </button>
        <button
          type="button"
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold"
          onClick={() => void post("calendar_failure", { startAt: slots[1]?.startAt || slots[0]?.startAt || "" })}
        >
          {t("fail")}
        </button>
      </div>
      {output ? <pre className="overflow-auto rounded-md bg-navy/5 p-3 text-xs text-navy">{output}</pre> : null}
    </section>
  );
}
