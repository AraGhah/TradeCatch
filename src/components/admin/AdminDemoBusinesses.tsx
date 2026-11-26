"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PlanId } from "@/product/saas/entitlements";

import { BusyLabel, InlineStatus } from "@/components/ui/Spinner";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
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
  subscriptionPlan: PlanId;
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
  subscriptionPlan: "professional",
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
  const [, startTransition] = useTransition();
  // False until the list has been read once: "No demo businesses yet" is a claim about a list we have not seen.
  const [loaded, setLoaded] = useState(false);
  // Which action is running ("create", "seed:<id>", ...). Only that button shows its busy words; the others wait so two changes never overlap.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = busyKey !== null;
  // The create request's idempotency key, kept after an answer is lost so pressing the button again is the same request (one business), and dropped once the server has answered or the form changed.
  const createKey = useRef<{ key: string; body: string } | null>(null);

  /**
   * Runs one action and always ends it. A request that throws (offline, or no
   * answer within the time limit) is reported as "may already have gone
   * through", not "failed": nothing says whether the server did the work.
   */
  async function perform(key: string, work: () => Promise<void>) {
    setBusyKey(key);
    try {
      await work();
    } catch {
      setMessage(null);
      setError(t("errors.unconfirmed"));
    } finally {
      setBusyKey(null);
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await timedFetch("/api/admin/demo-businesses");
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        businesses?: Business[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || t("errors.load"));
        return;
      }
      setBusinesses(json.businesses ?? []);
    } catch {
      setError(t("errors.load"));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  const createBusiness = useGuarded(createBusinessHandler);
  async function createBusinessHandler(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const body = JSON.stringify({
      ...form,
      phoneNumber: form.phoneNumber || undefined,
      accountType: "demo",
    });
    if (!createKey.current || createKey.current.body !== body) {
      createKey.current = {
        key:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `demo-${Date.now()}`,
        body,
      };
    }
    const idempotencyKey = createKey.current.key;

    await perform("create", async () => {
      const res = await timedFetch("/api/admin/demo-businesses", {
        method: "POST",
        timeoutMs: 60_000,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; business?: Business };
      if (!res.ok) {
        // A refusal is final; a server error may or may not have created it, so its key is kept.
        if (res.status < 500) createKey.current = null;
        setError(json.error || t("errors.create"));
        return;
      }
      createKey.current = null;
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setMessage(t("created"));
      await load();
    });
  }

  const seed = useGuarded(seedHandler);
  async function seedHandler(id: string) {
    setError(null);
    setMessage(null);
    await perform(`seed:${id}`, async () => {
      const res = await timedFetch(`/api/admin/demo-businesses/${id}/seed`, {
        method: "POST",
        timeoutMs: 60_000,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errors.seed"));
        return;
      }
      setMessage(t("seeded"));
    });
  }

  const reset = useGuarded(resetHandler);
  async function resetHandler(id: string) {
    if (!window.confirm(t("confirmReset"))) return;
    setError(null);
    setMessage(null);
    await perform(`reset:${id}`, async () => {
      const res = await timedFetch(`/api/admin/demo-businesses/${id}/reset`, {
        method: "POST",
        timeoutMs: 60_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_DEMO_ACCOUNT", reseed: true }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errors.reset"));
        return;
      }
      setMessage(t("resetDone"));
    });
  }

  const remove = useGuarded(removeHandler);
  async function removeHandler(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    setError(null);
    setMessage(null);
    await perform(`delete:${id}`, async () => {
      const res = await timedFetch(`/api/admin/demo-businesses/${id}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errors.delete"));
        return;
      }
      setMessage(t("deleted"));
      await load();
    });
  }

  const openDashboard = useGuarded(openDashboardHandler);
  async function openDashboardHandler(id: string) {
    setError(null);
    await perform(`open:${id}`, async () => {
      const res = await timedFetch("/api/app/switch-organization", {
        method: "POST",
        timeoutMs: 60_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errors.switch"));
        return;
      }
      window.location.assign(locale === "fr" ? "/fr/app" : "/app");
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-extrabold text-navy">
            {t("headline")}
          </h2>
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
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      {formOpen ? (
        <form
          onSubmit={(e) => void createBusiness(e)}
          aria-busy={busyKey === "create"}
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
                required={
                  key === "businessName" ||
                  key === "ownerEmail" ||
                  key === "industry"
                }
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
                  subscriptionPlan: e.target.value as PlanId,
                }))
              }
              className="rounded-md border border-navy/20 px-3 py-2"
            >
              <option value="professional">Professional</option>
              <option value="essential">Essential</option>
              <option value="receptionist">Receptionist Plus (earlier plan)</option>
              <option value="growth">Growth (earlier plan)</option>
              <option value="starter">Starter (earlier plan)</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              aria-busy={busyKey === "create"}
              className="rounded-md bg-orange px-4 py-2.5 text-sm font-semibold text-navy hover:bg-orange/90 disabled:opacity-60"
            >
              <BusyLabel pending={busyKey === "create"} busyLabel={t("creating")}>
                {t("submitCreate")}
              </BusyLabel>
            </button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col gap-4">
        {!loaded ? (
          <li>
            <InlineStatus>{t("loadingList")}</InlineStatus>
          </li>
        ) : null}
        {loaded && businesses.length === 0 ? (
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
                  disabled={busy}
                  aria-busy={busyKey === `open:${biz.id}`}
                  onClick={() => void openDashboard(biz.id)}
                  className="rounded-md bg-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  <BusyLabel pending={busyKey === `open:${biz.id}`} busyLabel={t("working")}>
                    {t("openDashboard")}
                  </BusyLabel>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busyKey === `seed:${biz.id}`}
                  onClick={() => void seed(biz.id)}
                  className="rounded-md border border-navy/20 px-3 py-2 text-xs font-semibold text-navy disabled:opacity-60"
                >
                  <BusyLabel pending={busyKey === `seed:${biz.id}`} busyLabel={t("working")}>
                    {t("generateData")}
                  </BusyLabel>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busyKey === `reset:${biz.id}`}
                  onClick={() => void reset(biz.id)}
                  className="rounded-md border border-navy/20 px-3 py-2 text-xs font-semibold text-navy disabled:opacity-60"
                >
                  <BusyLabel pending={busyKey === `reset:${biz.id}`} busyLabel={t("working")}>
                    {t("reset")}
                  </BusyLabel>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busyKey === `delete:${biz.id}`}
                  onClick={() => void remove(biz.id)}
                  className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-60"
                >
                  <BusyLabel pending={busyKey === `delete:${biz.id}`} busyLabel={t("working")}>
                    {t("delete")}
                  </BusyLabel>
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
