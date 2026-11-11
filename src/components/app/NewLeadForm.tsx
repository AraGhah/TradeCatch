"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const DESCRIPTION_MAX = 2000;

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
  // Set when the number already belongs to a customer with another name.
  const [existingName, setExistingName] = useState("");

  async function submit(existingCustomer?: "keep" | "rename") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/businesses/${organizationId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneE164: phone.trim(),
          displayName: name.trim() || undefined,
          service: service.trim() || undefined,
          description: description.trim() || undefined,
          existingCustomer,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        existingName?: string;
        lead?: { id: string };
      };
      if (res.status === 409 && data.code === "existing_customer") {
        setExistingName(data.existingName ?? "");
        return;
      }
      if (!res.ok || !data.lead) {
        setExistingName("");
        setError(
          data.code === "invalid_phone"
            ? t("errorPhone")
            : data.code === "too_long"
              ? t("errorTooLong")
              : t("error"),
        );
        return;
      }
      router.push({
        pathname: "/app/leads/[id]",
        params: { id: data.lead.id },
      });
    } catch {
      setError(t("error"));
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
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="grid gap-3 rounded-md border border-navy/10 bg-white p-4 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("phone")}
        <input
          required
          type="tel"
          inputMode="tel"
          maxLength={40}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setExistingName("");
          }}
          className="rounded-md border border-navy/20 px-2 py-2"
          placeholder="514-555-0123"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("name")}
        <input
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setExistingName("");
          }}
          className="rounded-md border border-navy/20 px-2 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-navy">
        {t("service")}
        <input
          value={service}
          maxLength={160}
          onChange={(e) => setService(e.target.value)}
          className="rounded-md border border-navy/20 px-2 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-navy sm:col-span-2">
        {t("description")}
        <textarea
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-navy/20 px-2 py-2"
        />
        <span className="text-xs text-navy/60">
          {description.length} / {DESCRIPTION_MAX}
          {description.length >= DESCRIPTION_MAX
            ? ` · ${t("descriptionLimit")}`
            : ""}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {error}
        </p>
      ) : null}
      {existingName ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-navy sm:col-span-2"
        >
          <p className="m-0">
            {t("existingCustomer", { existing: existingName, typed: name.trim() })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit("keep")}
              className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("existingKeep", { existing: existingName })}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit("rename")}
              className="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50"
            >
              {t("existingRename", { typed: name.trim() })}
            </button>
          </div>
        </div>
      ) : null}
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
