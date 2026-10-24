"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale } from "next-intl";
import type {
  InstallationDomain,
  InstallationAudit,
} from "@/product/installations/model";
import {
  installationSnapshot,
  installationReceipt,
} from "@/product/installations/model";

const copy = {
  en: {
    title: "Installation approvals",
    notice:
      "Enforcement ships OFF. Do not enable it until existing installations and exact preview domains are inventoried and approved. Approving a record does not enable enforcement.",
    load: "Loading approvals…",
    error: "Installation registry could not be loaded.",
    retry: "Retry",
    refresh: "Refresh",
    empty: "No domains registered.",
    label: "Installation name",
    origin: "Exact origin",
    existing: "Existing installation ID (blank for a new installation)",
    reason: "Reason / inventory evidence",
    save: "Register pending domain",
    saved: "Change saved.",
    failed:
      "Change failed. No approval was confirmed. Refresh before retrying.",
    credential:
      "Save this installation credential securely now. It is shown once; never put it in client code or version control.",
    clear: "Clear credential",
    approve: "Approve",
    reject: "Reject",
    revoke: "Revoke",
    audit: "Recent approval audit",
    mode: "Enforcement configuration",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    revoked: "Revoked",
  },
  fr: {
    title: "Approbation des installations",
    notice:
      "Le contrôle est livré DÉSACTIVÉ. Ne l’activez pas avant d’avoir inventorié et approuvé les installations existantes et chaque domaine d’aperçu exact. Une approbation n’active pas le contrôle.",
    load: "Chargement des approbations…",
    error: "Le registre des installations n’a pas pu être chargé.",
    retry: "Réessayer",
    refresh: "Actualiser",
    empty: "Aucun domaine enregistré.",
    label: "Nom de l’installation",
    origin: "Origine exacte",
    existing:
      "ID d’installation existante (vide pour une nouvelle installation)",
    reason: "Motif / preuve d’inventaire",
    save: "Enregistrer un domaine en attente",
    saved: "Changement enregistré.",
    failed:
      "Échec du changement. Aucune approbation confirmée. Actualisez avant de réessayer.",
    credential:
      "Conservez ce secret d’installation en lieu sûr maintenant. Il ne sera affiché qu’une fois; jamais dans le code client ou le dépôt.",
    clear: "Effacer le secret",
    approve: "Approuver",
    reject: "Refuser",
    revoke: "Révoquer",
    audit: "Journal récent des décisions",
    mode: "Configuration du contrôle",
    pending: "En attente",
    approved: "Approuvé",
    rejected: "Refusé",
    revoked: "Révoqué",
  },
};

export function InstallationApprovals() {
  const t = copy[useLocale() === "fr" ? "fr" : "en"];
  const [data, setData] = useState<{
    domains: InstallationDomain[];
    audit: InstallationAudit[];
    enforcement: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState<{
    installationId: string;
    credential: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/admin/installations", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const body = installationSnapshot.parse(await response.json());
      setData(body);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // Initial authenticated client fetch; event-driven retries share this loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function change(command: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, reason }),
      });
      if (!response.ok) throw new Error();
      const body = installationReceipt.parse(await response.json());
      if (typeof body.credential === "string")
        setCredential({
          installationId: body.installationId,
          credential: body.credential,
        });
      setMessage(t.saved);
      await load();
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  }
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const installationId = String(fields.get("installationId") || "").trim();
    void change(
      installationId
        ? { action: "add_domain", installationId, origin: fields.get("origin") }
        : {
            action: "register",
            label: fields.get("label"),
            origin: fields.get("origin"),
          },
    );
  }
  const inputClass = "w-full rounded border border-navy/30 p-2";
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="rounded border border-orange p-3">{t.notice}</p>
      <button
        type="button"
        disabled={loading || busy}
        onClick={() => void load()}
      >
        {t.refresh}
      </button>
      {loading && <p role="status">{t.load}</p>}
      {error && (
        <div role="alert">
          <p>{t.error}</p>
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            {t.retry}
          </button>
        </div>
      )}
      {data && (
        <p>
          {t.mode}: <code>{data.enforcement}</code>
        </p>
      )}
      <form onSubmit={register} className="space-y-3">
        <label className="block">
          {t.label}
          <input name="label" maxLength={100} className={inputClass} />
        </label>
        <label className="block">
          {t.existing}
          <input name="installationId" maxLength={36} className={inputClass} />
        </label>
        <label className="block">
          {t.origin}
          <input
            required
            name="origin"
            type="url"
            maxLength={300}
            placeholder="https://example.com"
            className={inputClass}
          />
        </label>
        <label className="block">
          {t.reason}
          <textarea
            required
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          disabled={
            busy ||
            !data ||
            error ||
            credential !== null ||
            reason.trim().length < 5
          }
          type="submit"
        >
          {t.save}
        </button>
      </form>
      {message && (
        <p role={message === t.failed ? "alert" : "status"}>{message}</p>
      )}
      {credential && (
        <aside className="rounded border border-navy p-3" role="status">
          <p>{t.credential}</p>
          <p>
            <code>{credential.installationId}</code>
          </p>
          <code className="break-all">{credential.credential}</code>
          <button type="button" onClick={() => setCredential(null)}>
            {t.clear}
          </button>
        </aside>
      )}
      {data && data.domains.length === 0 && <p>{t.empty}</p>}
      <ul className="space-y-3">
        {data?.domains.map((domain) => (
          <li
            key={domain.id}
            data-domain-id={domain.id}
            className="rounded border border-navy/20 p-3"
          >
            <p>
              {domain.label} —{" "}
              <code className="break-all">{domain.origin}</code> —{" "}
              {t[domain.status]}
            </p>
            <p>
              <code className="break-all">{domain.installationId}</code>
            </p>
            {(["approved", "rejected", "revoked"] as const)
              .filter(
                (status) =>
                  status !== domain.status &&
                  (status !== "rejected" || domain.status === "pending") &&
                  (status !== "revoked" || domain.status === "approved"),
              )
              .map((status) => (
                <button
                  key={status}
                  className="mr-4 underline"
                  type="button"
                  disabled={
                    busy || loading || error || reason.trim().length < 5
                  }
                  onClick={() =>
                    void change({
                      action: "decide",
                      domainId: domain.id,
                      status,
                      revision: domain.revision,
                    })
                  }
                >
                  {status === "approved"
                    ? t.approve
                    : status === "rejected"
                      ? t.reject
                      : t.revoke}
                </button>
              ))}
            <button
              type="button"
              className="underline"
              disabled={busy || loading || error || reason.trim().length < 5}
              onClick={() =>
                void change({
                  action: "revoke_installation",
                  installationId: domain.installationId,
                })
              }
            >
              {t === copy.fr
                ? "Révoquer tous les domaines de cette installation"
                : "Revoke all domains of this installation"}
            </button>
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-semibold">{t.audit}</h2>
      <ul className="space-y-2">
        {data?.audit.map((row) => (
          <li key={row.id}>
            <code>{row.createdAt}</code> — {row.actor} — {row.domainId} —{" "}
            {row.fromStatus ?? "—"} → {row.toStatus}: {row.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
