"use client";

import { useCallback, useEffect, useState } from "react";

import { useGuarded, useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { BusyLabel, InlineStatus } from "@/components/ui/Spinner";
import { ActionButton } from "@/components/ui/ActionButton";

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
  const [created, setCreated] = useState(false);
  const openFlight = useSingleFlight();

  const load = useCallback(
    () =>
      timedFetch("/api/admin/pilots")
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

  async function openHandler(id: string) {
    setSelected(id);
    const response = await timedFetch(`/api/admin/pilots/${id}`);
    const body = (await response.json()) as { tests?: TestRow[] };
    setTests(body.tests ?? []);
    const reportResponse = await timedFetch(
      `/api/admin/pilots/${id}?view=report`,
    );
    const reportBody = (await reportResponse.json()) as { report?: Report };
    setReport(reportBody.report ?? null);
  }

  const createPilot = useGuarded(createPilotHandler);
  const [creating, setCreating] = useState(false);
  async function createPilotHandler() {
    setCreating(true);
    setCreated(false);
    setMessage("");
    try {
      const response = await timedFetch("/api/admin/pilots", {
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
      if (response.ok) {
        setCreated(true);
        setMessage(
          "Pilot created. Live tests stay pending until you record an authorized call.",
        );
      } else {
        setMessage(body.error || "Could not create the pilot.");
      }
      await load();
    } catch {
      setMessage("Could not create the pilot. Check the connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-extrabold text-navy">
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
          disabled={creating}
          onChange={(event) => {
            setOrganizationId(event.target.value);
            setCreated(false);
          }}
        />
        <input
          className="rounded-md border border-navy/15 px-2 py-2 text-sm"
          placeholder="Business name"
          value={businessName}
          disabled={creating}
          onChange={(event) => {
            setBusinessName(event.target.value);
            setCreated(false);
          }}
        />
        <input
          className="rounded-md border border-navy/15 px-2 py-2 text-sm"
          placeholder="Contact email"
          value={contactEmail}
          disabled={creating}
          onChange={(event) => {
            setContactEmail(event.target.value);
            setCreated(false);
          }}
        />
        <ActionButton
          type="submit"
          pending={creating}
          busyLabel="Creating…"
          success={created}
          successLabel="Created"
          className="rounded-md bg-navy px-3 py-2 text-sm text-white"
        >
          Create pilot
        </ActionButton>
      </form>
      {message ? (
        <p
          className="text-sm text-navy"
          role={created ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2 text-sm">
        {pilots.map((pilot) => {
          const opening = openFlight.pending && selected === pilot.id;
          return (
            <li key={pilot.id}>
              <button
                type="button"
                disabled={openFlight.pending}
                aria-busy={opening || undefined}
                className="text-left text-navy underline disabled:opacity-60"
                onClick={() =>
                  void openFlight.run(() => openHandler(pilot.id))
                }
              >
                <BusyLabel pending={opening} busyLabel="Opening…">
                  {pilot.businessName} · {pilot.pilotStatus} · phone{" "}
                  {pilot.phoneStatus} · Receptionist {pilot.aiStatus}
                </BusyLabel>
              </button>
            </li>
          );
        })}
      </ul>
      {openFlight.pending ? <InlineStatus>Loading pilot…</InlineStatus> : null}
      {selected && !openFlight.pending ? (
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
