"use client";

import { useState } from "react";

import { BusyLabel } from "@/components/ui/Spinner";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
export function PilotFeedbackForm({ organizationId }: { organizationId: string }) {
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useGuarded(submitHandler);
  async function submitHandler() {
    setBusy(true);
    try {
      const response = await timedFetch(`/api/businesses/${organizationId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "ai", description, priority: "medium" }),
      });
      setMessage(response.ok ? "Feedback sent." : "Could not send feedback.");
    } catch {
      setMessage("Could not send feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex max-w-xl flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea className="min-h-28 rounded-md border border-navy/15 px-3 py-2 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What happened?" />
      <button type="submit" disabled={busy} aria-busy={busy} className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50">
        <BusyLabel pending={busy} busyLabel="Sending…">Send</BusyLabel>
      </button>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </form>
  );
}
