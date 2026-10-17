"use client";

export function ReliabilityTestPanel({ organizationId }: { organizationId: string }) {
  async function run(scenario: string) {
    await fetch("/api/admin/monitoring/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario, organizationId }),
    });
  }

  return (
    <section className="rounded-md bg-white p-4 ring-1 ring-navy/10">
      <h2 className="font-semibold text-navy">System reliability</h2>
      <p className="mt-1 text-sm text-navy/70">These simulations stay inside TradeCatch. They do not call Twilio, Stripe, Google, or any other external provider.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => run("ai_timeout")}>Simulate provider timeout</button>
        <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => run("job_failure")}>Simulate job failure</button>
        <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => run("cost_threshold")}>Simulate cost threshold</button>
      </div>
    </section>
  );
}
