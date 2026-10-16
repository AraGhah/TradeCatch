"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function NewLeadForm({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.crm");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/businesses/${organizationId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneE164: phone,
          displayName: name,
          service,
          description,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        lead?: { id: string };
      };
      if (!res.ok || !data.lead) {
        setError(data.error || t("error"));
        return;
      }
      router.push({
        pathname: "/app/leads/[id]",
        params: { id: data.lead.id },
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"
      >
        {t("newLead")}
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-md border border-navy/10 bg-white p-4 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("phone")}
        <input
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="rounded-md border border-navy/20 px-2 py-2"
          placeholder="+14385550100"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("name")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-navy/20 px-2 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("service")}
        <input
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="rounded-md border border-navy/20 px-2 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-navy sm:col-span-2">
        {t("description")}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-navy/20 px-2 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-navy/20 px-4 py-2 text-sm text-navy"
        >
          {t("clear")}
        </button>
      </div>
    </form>
  );
}
