"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

type Business = {
  id: string;
  name: string;
  industry: string;
  city: string | null;
  subscriptionPlan: string;
  status: string;
  ownerEmail?: string;
  features: Record<string, boolean>;
};

type FormState = {
  businessName: string;
  industry: string;
  ownerEmail: string;
  ownerName: string;
  phoneNumber: string;
  city: string;
  serviceArea: string;
  language: "en" | "fr";
  timezone: string;
  subscriptionPlan: "starter" | "growth";
  accountStatus: "active" | "suspended";
};

const EMPTY_FORM: FormState = {
  businessName: "",
  industry: "plumbing",
  ownerEmail: "",
  ownerName: "",
  phoneNumber: "",
  city: "Montréal",
  serviceArea: "Montréal, Laval",
  language: "fr",
  timezone: "America/Toronto",
  subscriptionPlan: "growth",
  accountStatus: "active",
};

export function AdminDemoBusinesses() {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/demo-businesses");
    const json = (await res.json()) as {
      ok?: boolean;
      businesses?: Business[];
      error?: string;
    };
    if (!res.ok) {
      setError(json.error || t("errors.load"));
      return;
    }
    setBusinesses(json.businesses ?? []);
  }, [t]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  async function createBusiness(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `demo-${Date.now()}`;

    const res = await fetch("/api/admin/demo-businesses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        ...form,
        phoneNumber: form.phoneNumber || undefined,
        accountType: "demo",
      }),
    });
    const json = (await res.json()) as { error?: string; business?: Business };
    if (!res.ok) {
      setError(json.error || t("errors.create"));
      return;
    }
    setFormOpen(false);
    setForm(EMPTY_FORM);
    setMessage(t("created"));
    await load();
  }

  async function seed(id: string) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/admin/demo-businesses/${id}/seed`, {
      method: "POST",
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error || t("errors.seed"));
      return;
    }
    setMessage(t("seeded"));
  }

  async function reset(id: string) {
    if (!window.confirm(t("confirmReset"))) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/admin/demo-businesses/${id}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET_DEMO_ACCOUNT", reseed: true }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error || t("errors.reset"));
      return;
    }
    setMessage(t("resetDone"));
  }

  async function remove(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/admin/demo-businesses/${id}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error || t("errors.delete"));
      return;
    }
    setMessage(t("deleted"));
    await load();
  }

  async function openDashboard(id: string) {
    setError(null);
    const res = await fetch("/api/app/switch-organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error || t("errors.switch"));
      return;
    }
    window.location.href = locale === "fr" ? "/fr/app" : "/app";
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy md:text-3xl">
            {t("headline")}
          </h1>
          <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60"
        >
          {formOpen ? t("cancel") : t("createButton")}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      {formOpen ? (
        <form
          onSubmit={(e) => void createBusiness(e)}
          className="grid gap-4 rounded-md border border-navy/10 bg-white p-5 md:grid-cols-2"
        >
          {(
            [
              ["businessName", "text"],
              ["industry", "text"],
              ["ownerEmail", "email"],
              ["ownerName", "text"],
              ["phoneNumber", "tel"],
              ["city", "text"],
              ["serviceArea", "text"],
              ["timezone", "text"],
            ] as const
          ).map(([key, type]) => (
            <label key={key} className="flex flex-col gap-1 text-sm text-navy">
              <span className="font-medium">{t(`fields.${key}`)}</span>
              <input
                required={key === "businessName" || key === "ownerEmail" || key === "industry"}
                type={type}
                value={form[key]}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [key]: e.target.value }))
                }
                className="rounded-md border border-navy/20 px-3 py-2"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm text-navy">
            <span className="font-medium">{t("fields.language")}</span>
            <select
              value={form.language}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  language: e.target.value as "en" | "fr",
                }))
              }
              className="rounded-md border border-navy/20 px-3 py-2"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-navy">
            <span className="font-medium">{t("fields.subscriptionPlan")}</span>
            <select
              value={form.subscriptionPlan}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  subscriptionPlan: e.target.value as "starter" | "growth",
                }))
              }
              className="rounded-md border border-navy/20 px-3 py-2"
            >
              <option value="growth">Growth</option>
              <option value="starter">Starter</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-orange px-4 py-2.5 text-sm font-semibold text-navy hover:bg-orange/90 disabled:opacity-60"
            >
              {t("submitCreate")}
            </button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col gap-4">
        {businesses.length === 0 && !pending ? (
          <li className="rounded-md border border-dashed border-navy/20 px-4 py-8 text-center text-navy/60">
            {t("empty")}
          </li>
        ) : null}
        {businesses.map((biz) => (
          <li
            key={biz.id}
            className="rounded-md border border-navy/10 bg-white px-5 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-navy/50">
                  {t("demoBadge")}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-navy">
                  {biz.name}
                </h2>
                <p className="text-sm text-navy/60">
                  {biz.industry}
                  {biz.city ? ` · ${biz.city}` : ""} · {biz.subscriptionPlan} ·{" "}
                  {biz.status}
                </p>
                {biz.ownerEmail ? (
                  <p className="mt-1 text-xs text-navy/50">{biz.ownerEmail}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openDashboard(biz.id)}
                  className="rounded-md bg-navy px-3 py-2 text-xs font-semibold text-white"
                >
                  {t("openDashboard")}
                </button>
                <button
                  type="button"
                  onClick={() => void seed(biz.id)}
                  className="rounded-md border border-navy/20 px-3 py-2 text-xs font-semibold text-navy"
                >
                  {t("generateData")}
                </button>
                <button
                  type="button"
                  onClick={() => void reset(biz.id)}
                  className="rounded-md border border-navy/20 px-3 py-2 text-xs font-semibold text-navy"
                >
                  {t("reset")}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(biz.id)}
                  className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700"
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
