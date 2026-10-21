"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";

type ServiceCard = {
  state?: string;
  evidenceAt?: string;
  service: string;
  status: string;
  detail?: string;
  checkedAt: string;
};
type Overview = {
  overall?: string;
  services?: ServiceCard[];
  requests?: number;
  success?: number;
  clientErrors?: number;
  serverErrors?: number;
  errorRate?: number;
  averageMs?: number;
  p95Ms?: number;
  incidents?: {
    id: string;
    title: string;
    severity: string;
    status: string;
    service: string;
  }[];
  recentErrors?: {
    id: string;
    errorCode: string;
    service: string;
    requestId: string;
    detail?: string;
    createdAt: string;
  }[];
  jobs?: { pending: number; failed: number; dead: number; resolved: number };
  costs?: {
    estimated: boolean;
    confirmed: boolean;
    totalEstimatedCents: number;
    rows: { service: string; estimatedCents: number; simulated: boolean }[];
  };
  errors?: {
    id: string;
    errorCode: string;
    service: string;
    organizationId?: string;
    requestId: string;
    detail?: string;
  }[];
  ai?: ServiceCard;
  failedCalls?: number;
  deployments?: {
    id: string;
    version: string;
    environment: string;
    status: string;
    deployedAt: string;
  }[];
  note?: string;
};

const SERVICE_LABEL: Record<string, string> = {
  ai: "receptionist",
  ai_receptionist: "receptionist",
};

const LINKS = [
  { href: "/admin/monitoring", label: "Overview" },
  { href: "/admin/monitoring/api", label: "API" },
  { href: "/admin/monitoring/errors", label: "Errors" },
  { href: "/admin/monitoring/jobs", label: "Jobs" },
  { href: "/admin/monitoring/receptionist", label: "Receptionist" },
  { href: "/admin/monitoring/database", label: "Database" },
  { href: "/admin/monitoring/deployments", label: "Deployments" },
  { href: "/admin/monitoring/costs", label: "Costs" },
] as const;

export function MonitoringDesk({
  section,
}: {
  section:
    | "overview"
    | "api"
    | "errors"
    | "jobs"
    | "ai"
    | "database"
    | "deployments"
    | "costs";
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const path =
      section === "overview" || section === "database"
        ? "/api/admin/monitoring/overview"
        : section === "api"
          ? "/api/admin/monitoring/overview"
          : section === "errors"
            ? "/api/admin/monitoring/errors"
            : section === "jobs"
              ? "/api/admin/monitoring/jobs"
              : section === "ai"
                ? "/api/admin/monitoring/calls"
                : section === "costs"
                  ? "/api/admin/monitoring/costs"
                  : "/api/admin/deployments";
    fetch(path)
      .then((response) => response.json())
      .then((body) => setData(body as Overview))
      .catch(() => setMessage("Monitoring data could not be loaded."));
  }, [section]);

  async function simulate(scenario: string) {
    const response = await fetch("/api/admin/monitoring/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    setMessage(
      body.ok
        ? "Simulation recorded. No provider was contacted."
        : body.error || "Simulation failed.",
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          System monitoring
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-navy/70">
          Status comes from the latest checks. An optional integration can fail
          without taking the whole platform offline.
        </p>
      </header>
      <nav className="flex flex-wrap gap-2 text-sm">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md bg-white px-3 py-2 text-navy ring-1 ring-navy/10"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
      {section === "overview" || section === "database" ? (
        <section className="grid gap-3 md:grid-cols-3">
          <article className="rounded-md bg-white p-4 ring-1 ring-navy/10">
            <p className="text-xs uppercase tracking-wide text-navy/50">
              Overall
            </p>
            <p className="mt-2 text-lg font-semibold text-navy">
              {data?.overall || "…"}
            </p>
          </article>
          {(data?.services || []).map((service) => (
            <article
              key={service.service}
              className="rounded-md bg-white p-4 ring-1 ring-navy/10"
            >
              <p className="text-xs uppercase tracking-wide text-navy/50">
                {SERVICE_LABEL[service.service] ?? service.service}
              </p>
              <p className="mt-2 font-semibold text-navy">{service.status}</p>
              <p className="mt-1 text-sm text-navy">
                Verification: {service.state?.replaceAll("_", " ") || "unknown"}
              </p>
              {service.evidenceAt ? (
                <p className="text-xs text-navy/60">
                  Evidence: {service.evidenceAt}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-navy/60">{service.detail}</p>
            </article>
          ))}
        </section>
      ) : null}
      {section === "database" ? (
        <p className="max-w-2xl text-sm text-navy/70">
          TradeCatch stores contractor data in Postgres. A database restore
          overwrites that database, so recovery tests belong on a disposable
          staging database. Rolling back a Worker does not undo SQL migrations.
        </p>
      ) : null}
      {section === "api" ? (
        <dl className="grid gap-3 rounded-md bg-white p-4 text-sm ring-1 ring-navy/10 md:grid-cols-3">
          <div>
            <dt className="text-navy/50">Requests</dt>
            <dd>{data?.requests ?? 0}</dd>
          </div>
          <div>
            <dt className="text-navy/50">Successful</dt>
            <dd>{data?.success ?? 0}</dd>
          </div>
          <div>
            <dt className="text-navy/50">Client errors</dt>
            <dd>{data?.clientErrors ?? 0}</dd>
          </div>
          <div>
            <dt className="text-navy/50">Server errors</dt>
            <dd>{data?.serverErrors ?? 0}</dd>
          </div>
          <div>
            <dt className="text-navy/50">Error rate</dt>
            <dd>{Math.round((data?.errorRate || 0) * 100)}%</dd>
          </div>
          <div>
            <dt className="text-navy/50">Average / p95</dt>
            <dd>
              {data?.averageMs ?? 0} ms / {data?.p95Ms ?? 0} ms
            </dd>
          </div>
        </dl>
      ) : null}
      {section === "errors" || section === "overview" ? (
        <ul className="flex flex-col gap-2 text-sm">
          {(data?.recentErrors || data?.errors || []).map((error) => (
            <li
              key={error.id}
              className="rounded-md bg-white px-3 py-2 ring-1 ring-navy/10"
            >
              {SERVICE_LABEL[error.service] ?? error.service} ·{" "}
              {error.errorCode} · {error.requestId}
            </li>
          ))}
        </ul>
      ) : null}
      {section === "jobs" ? (
        <p className="text-sm text-navy">
          Pending retries {data?.jobs?.pending ?? 0} · Failed{" "}
          {data?.jobs?.failed ?? 0} · Dead letter {data?.jobs?.dead ?? 0}
        </p>
      ) : null}
      {section === "ai" ? (
        <p className="text-sm text-navy">
          Receptionist status {data?.ai?.status || "unknown"} · Failed sessions{" "}
          {data?.failedCalls ?? 0}
        </p>
      ) : null}
      {section === "costs" ? (
        <p className="text-sm text-navy">
          Estimated {((data?.costs?.totalEstimatedCents || 0) / 100).toFixed(2)}{" "}
          CAD. These figures are estimates, not provider-confirmed charges.
        </p>
      ) : null}
      {section === "deployments" ? (
        <ul className="text-sm">
          {(data?.deployments || []).map((row) => (
            <li key={row.id}>
              {row.environment} {row.version} · {row.status} · {row.deployedAt}
            </li>
          ))}
          <li className="mt-2 text-navy/70">{data?.note}</li>
        </ul>
      ) : null}
      {section === "overview" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-navy px-3 py-2 text-sm text-white"
            onClick={() => simulate("ai_timeout")}
          >
            Simulate Receptionist timeout
          </button>
          <button
            type="button"
            className="rounded-md bg-navy px-3 py-2 text-sm text-white"
            onClick={() => simulate("job_failure")}
          >
            Simulate job failure
          </button>
          <button
            type="button"
            className="rounded-md bg-navy px-3 py-2 text-sm text-white"
            onClick={() => simulate("cost_threshold")}
          >
            Simulate cost threshold
          </button>
        </div>
      ) : null}
    </div>
  );
}
