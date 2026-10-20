"use client";

import { useCallback, useEffect, useState } from "react";

type Pilot = {
  id: string;
  businessName: string;
  pilotStatus: string;
  aiStatus: string;
  phoneStatus: string;
  contactEmail: string;
};
type TestRow = { scenario: string; status: string };
type Report = {
  businessName: string;
  openFeedback: number;
  attributedRevenue: null;
  activity: { incomingCalls: number; leads: number };
};

export function PilotDesk() {
  const [businessName, setBusinessName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(
    () =>
      fetch("/api/admin/pilots")
        .then(async (response) => ({
          response,
          body: (await response.json()) as { pilots?: Pilot[] },
        }))
        .then(({ body }) => {
          setPilots(body.pilots ?? []);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setSelected(id);
    const response = await fetch(`/api/admin/pilots/${id}`);
    const body = (await response.json()) as { tests?: TestRow[] };
    setTests(body.tests ?? []);
    const reportResponse = await fetch(`/api/admin/pilots/${id}?view=report`);
    const reportBody = (await reportResponse.json()) as { report?: Report };
    setReport(reportBody.report ?? null);
  }

  async function createPilot() {
    const response = await fetch("/api/admin/pilots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId,
        businessName,
        industry: "plumbing",
        contactName: businessName,
        contactEmail,
        accountType: "live",
      }),
    });
    const body = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? "Pilot created. Live tests stay pending until you record an authorized call."
        : body.error || "Could not create the pilot.",
    );
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        Pilot customers
      </h1>
      <p className="max-w-2xl text-sm text-navy/70">
        Start with one live business. Demo accounts cannot be activated, and the
        report does not invent revenue.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void createPilot();
        }}
      >
        <input
          className="rounded-md border border-navy/15 px-2 py-2 text-sm"
          placeholder="Business id"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        />
        <input
          className="rounded-md border border-navy/15 px-2 py-2 text-sm"
          placeholder="Business name"
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value)}
        />
        <input
          className="rounded-md border border-navy/15 px-2 py-2 text-sm"
          placeholder="Contact email"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
        />
        <button
          type="submit"
          className="rounded-md bg-navy px-3 py-2 text-sm text-white"
        >
          Create pilot
        </button>
      </form>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
      <ul className="flex flex-col gap-2 text-sm">
        {pilots.map((pilot) => (
          <li key={pilot.id}>
            <button
              type="button"
              className="text-left text-navy underline"
              onClick={() => open(pilot.id)}
            >
              {pilot.businessName} · {pilot.pilotStatus} · phone{" "}
              {pilot.phoneStatus} · Receptionist {pilot.aiStatus}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <section className="rounded-md bg-white p-4 text-sm ring-1 ring-navy/10">
          <h2 className="font-semibold text-navy">Live testing</h2>
          <ul className="mt-2">
            {tests.map((test) => (
              <li key={test.scenario}>
                {test.scenario} · {test.status}
              </li>
            ))}
          </ul>
          {report ? (
            <p className="mt-3">
              Calls {report.activity.incomingCalls} · Leads{" "}
              {report.activity.leads} · Open feedback {report.openFeedback} ·
              Revenue {String(report.attributedRevenue)}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
