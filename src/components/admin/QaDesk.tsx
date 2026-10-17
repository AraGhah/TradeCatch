"use client";

import { useEffect, useState } from "react";

type Result = { id: string; suite: string; name: string; status: string; expected: string; actual?: string; error?: string; durationMs: number };
type Run = { id: string; suite: string; status: string; passed: number; failed: number; skipped: number; durationMs: number; version: string; createdAt: string; results: Result[] };

const SUITES = ["all", "ai", "phone", "e2e", "appointments", "sms", "payments", "security", "failures", "performance"];

export function QaDesk() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [active, setActive] = useState<Run | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/admin/qa");
    const body = (await response.json()) as { runs?: Run[]; error?: string };
    if (!response.ok) setMessage(body.error || "Could not load test history.");
    setRuns(body.runs ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function run(suite: string) {
    setMessage("Running…");
    const response = await fetch("/api/admin/qa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suite }),
    });
    const body = (await response.json()) as { run?: Run; error?: string };
    if (!response.ok || !body.run) {
      setMessage(body.error || "The suite could not run.");
      return;
    }
    setActive(body.run);
    setMessage(`${body.run.passed} passed, ${body.run.failed} failed, ${body.run.skipped} skipped.`);
    await load();
  }

  const shown = active ?? runs[0];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">Test Center</h1>
        <p className="mt-2 max-w-2xl text-sm text-navy/70">Simulated suites use the TradeCatch backend and do not call Twilio, Stripe, Google, or an AI provider. A live phone test stays skipped until an authorized staging run.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {SUITES.map((suite) => (
          <button key={suite} type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => run(suite)}>
            {suite === "all" ? "Run all tests" : suite}
          </button>
        ))}
      </div>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
      {shown ? (
        <section className="rounded-md bg-white p-4 ring-1 ring-navy/10">
          <p className="text-sm text-navy">{shown.version} · {shown.status} · {shown.durationMs} ms · {shown.passed} passed · {shown.failed} failed · {shown.skipped} skipped</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {shown.results.map((result) => (
              <li key={result.id} className="rounded-md bg-[var(--color-surface,#f7f5f1)] px-3 py-2">
                <p className="font-semibold text-navy">{result.name} · {result.status} · {result.durationMs} ms</p>
                <p className="text-navy/70">Expected: {result.expected}</p>
                {result.actual ? <p>Actual: {result.actual}</p> : null}
                {result.error ? <p className="text-red-800">Error: {result.error}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : <p className="text-sm text-navy/70">No test run yet.</p>}
    </div>
  );
}
